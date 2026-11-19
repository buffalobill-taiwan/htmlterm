import { dealCard, runFlights, staggerFlights } from '../animation.js';
import { RANKS, SUITS } from '../deck.js';
import { mulberry32, SEED_MAX } from '../../../util/random.js';
import { SelectDialog } from '../../../dialog/SelectDialog.js';
import { ShowDialog } from '../../../dialog/ShowDialog.js';
import {
    MAX_HP, applyChoice, beginNextRoom, canFlee, cardLabel, copyState, createGame,
    dealInitialRoom, describeSlot, fleeRoom,
} from './rules.js';
import { showEffect as showEffectBox } from './effect.js';
import {
    DECK, DISCARD, SLAIN_SLOT, ScoundrelView, WEAPON_SLOT, roomPosition,
} from './view.js';

function normalizeKey(data) {
    if (typeof data !== 'string') return null;
    if (data === '\x1B') return 'Escape';
    const map = {
        '\x1B[A': 'ArrowUp', '\x1B[B': 'ArrowDown',
        '\x1B[C': 'ArrowRight', '\x1B[D': 'ArrowLeft',
        '\x1B[H': 'Home', '\x1B[F': 'End',
        '\x1B[1~': 'Home', '\x1B[4~': 'End',
        '\x1B[2~': 'Insert', '\x1B[3~': 'Delete',
        '\x1B[5~': 'PageUp', '\x1B[6~': 'PageDown',
        '\x1B[7~': 'Home', '\x1B[8~': 'End',
        '\x1B[Z': 'BackTab',
    };
    if (data.startsWith('\x1B')) return map[data] || null;
    return data;
}

function effectText(event, state) {
    if (event.type === 'equip') return `${cardLabel(event.card)} 裝備！威力 ${event.value}`;
    if (event.type === 'heal') return event.healed
        ? `${cardLabel(event.card)} 回 ${event.healed} HP（${state.hp}/${MAX_HP}）`
        : `${cardLabel(event.card)} 已滿血，沒有作用`;
    if (event.type === 'waste') return `本房已喝過，${cardLabel(event.card)} 浪費`;
    if (event.mode === 'weapon') return `${cardLabel(event.card)}(${event.value}) − 武器${event.weapon} → ` +
        (event.damage ? `扣 ${event.damage} HP` : '無傷！') + `；上限 ${event.lastKill}`;
    return `${cardLabel(event.card)} 空手 → 扣 ${event.damage} HP`;
}

function targetFor(event) {
    if (event.type === 'equip') return WEAPON_SLOT;
    if (event.type === 'heal' || event.type === 'waste') return DISCARD;
    return event.mode === 'weapon' ? SLAIN_SLOT : DISCARD;
}

export class ScoundrelGame {
    constructor(cmd) {
        this.cmd = cmd;
        this.view = new ScoundrelView();
        this.state = null;
        this.visualState = null;
        this.seed = 0;
        this.rng = Math.random;
        this.phase = 'idle';
        this.cursor = 0;
        this.animating = false;
        this.dealing = false;
        this.hiddenRoom = new Set();
        this.displaySlots = { weapon: null, slain: null };
        this.anims = new Set();
        this.batch = 0;
        this.disposed = false;
        this.dialog = null;
        this.cancelEffect = null;
        this.status = '';
    }

    start(seed) {
        if (this.disposed) return;
        this.stopAnimations();
        this.seed = seed == null ? Math.floor(Math.random() * (SEED_MAX + 1)) : seed;
        this.rng = mulberry32(this.seed);
        this.state = createGame(this.rng);
        this.visualState = null;
        this.displaySlots = { weapon: null, slain: null };
        this.phase = 'dealing';
        this.cursor = 0;
        this.status = '發牌中…';
        this.dealInitialRoom();
    }

    dealInitialRoom() {
        const drawn = dealInitialRoom(this.state);
        const batch = this.batch;
        const active = () => !this.disposed && batch === this.batch;
        this.dealing = true;
        this.hiddenRoom = new Set(drawn.map((_, index) => index));
        this.draw();
        if (!drawn.length) {
            this.dealing = false;
            this.hiddenRoom.clear();
            this.phase = 'choose';
            this.status = '←→ 選牌　Enter 確定';
            this.draw();
            return;
        }
        staggerFlights(this.anims, {
            count: drawn.length,
            isActive: active,
            start: (index, { onStep, onLand }) => dealCard(
                this.cmd, drawn[index], DECK, roomPosition(index), { onStep }, onLand,
            ),
            land: index => {
                this.hiddenRoom.delete(index);
                this.draw();
            },
            done: () => {
                if (!active()) return;
                this.dealing = false;
                this.hiddenRoom.clear();
                this.cursor = Math.min(this.cursor, Math.max(0, this.state.room.length - 1));
                this.phase = 'choose';
                this.status = '←→ 選牌　Enter 確定';
                this.draw();
            },
        });
    }

    draw() {
        if (!this.disposed && this.state) this.view.draw(this);
    }

    key(data) {
        if (this.disposed) return;
        const key = normalizeKey(data);
        if (!key) return;
        if (this.animating || this.dealing) {
            if (key === 'n' || key === 'N') return this.cmd._menu();
            if (key === 'q' || key === 'Q' || key === 'Escape') return this.cmd._confirmQuit();
            return;
        }
        if (key === 'q' || key === 'Q' || key === 'Escape') return this.cmd._confirmQuit();
        if (key === 'n' || key === 'N') return this.cmd._menu();
        if (key === 'h' || key === 'H') return this.showRules();
        if (this.phase === 'won' || this.phase === 'lost') {
            if (key === '\r' || key === '\n') return this.openResultDialog();
            return;
        }
        if (this.phase !== 'choose') return;
        if (key === 'ArrowLeft' || key === 'ArrowUp') return this.moveCursor(-1);
        if (key === 'ArrowRight' || key === 'ArrowDown') return this.moveCursor(1);
        if (key === 'Home') return this.moveCursorTo(false);
        if (key === 'End') return this.moveCursorTo(true);
        if (key === '\r' || key === '\n') return this.choose();
    }

    optionCount() {
        return this.state.room.length + (canFlee(this.state) ? 1 : 0);
    }

    moveCursor(delta) {
        const count = this.optionCount();
        if (!count) return;
        this.cursor = (this.cursor + delta + count) % count;
        this.draw();
    }

    moveCursorTo(last) {
        const count = this.optionCount();
        if (!count) return;
        this.cursor = last ? count - 1 : 0;
        this.draw();
    }

    choose() {
        const slot = this.cursor;
        if (slot === this.state.room.length) {
            if (canFlee(this.state)) this.flee();
            return;
        }
        const desc = describeSlot(this.state, slot);
        if (!desc) return;
        if (desc.kind === 'monster' && desc.canWeapon) return this.openCombatDialog(slot, desc);
        this.resolve(slot, 'barehand');
    }

    flee() {
        if (!canFlee(this.state)) return;
        const next = copyState(this.state);
        const returned = next.room.slice();
        const arrivals = fleeRoom(next);
        if (!arrivals) return;
        this.state = next;
        this.visualState = null;
        this.hiddenRoom = new Set(arrivals.map((_, index) => index));
        this.cursor = 0;
        this.phase = 'dealing';
        this.dealing = true;
        this.status = '逃離房間，重新發牌…';
        this.draw();
        const batch = this.batch;
        const active = () => !this.disposed && batch === this.batch;
        staggerFlights(this.anims, {
            count: arrivals.length,
            isActive: active,
            start: (index, { onStep, onLand }) => dealCard(
                this.cmd, arrivals[index], DECK, roomPosition(index), { onStep }, onLand,
            ),
            land: index => {
                this.hiddenRoom.delete(index);
                this.draw();
            },
            done: () => {
                if (!active()) return;
                this.dealing = false;
                this.hiddenRoom.clear();
                this.cursor = 0;
                this.phase = 'choose';
                this.status = '←→ 選牌　Enter 確定';
                this.showEffect(`逃離房間！${returned.length} 張牌已放回地城底`, () => this.draw());
            },
        });
    }

    openCombatDialog(slot, desc) {
        const weapon = this.state.weapon;
        const options = [
            {
                label: `用武器 ${cardLabel(weapon.card)}`,
                description: `扣 ${desc.weaponDamage} HP；上限 ${desc.value}`,
            },
            { label: '空手', description: `扣 ${desc.bareDamage} HP` },
        ];
        this.dialog = this.cmd.openDialog(SelectDialog, 'scoundrel-combat', {
            layout: 'list', title: '如何作戰', width: 42,
            options, selectedIndex: 0,
            onSelect: index => {
                this.dialog = null;
                this.resolve(slot, index === 0 ? 'weapon' : 'barehand');
            },
            onCancel: () => { this.dialog = null; this.draw(); },
            onAbort: () => this.cmd._quit(),
        });
    }

    resolve(slot, mode) {
        const card = this.state.room[slot];
        if (!card) return;
        const from = roomPosition(slot);
        const before = copyState(this.state);
        const next = copyState(this.state);
        const events = applyChoice(next, slot, mode);
        if (!events) return;
        this.state = next;
        this.visualState = before;
        this.hiddenRoom = new Set([slot]);
        this.phase = 'resolve';
        this.animating = true;
        this.status = '結算中…';
        this.draw();
        runFlights(this, [{
            card, from, to: targetFor(events[0]), options: { faceUp: true, duration: 220 },
        }], {
            done: () => this.finishResolve(events),
        });
    }

    finishResolve(events) {
        if (this.disposed) return;
        this.visualState = null;
        this.hiddenRoom.clear();
        this.animating = false;
        this.cursor = Math.min(this.cursor, Math.max(0, this.state.room.length - 1));
        const event = events[0];
        if (event.type === 'equip') {
            this.displaySlots.weapon = event.card;
            this.displaySlots.slain = null;
        } else if (event.mode === 'weapon') {
            this.displaySlots.slain = event.card;
        }
        this.draw();
        this.showEffect(effectText(event, this.state), () => {
            if (this.disposed) return;
            if (this.state.phase === 'won' || this.state.phase === 'lost') {
                this.enterSettlement();
                return;
            }
            if (this.state.resolved >= 3) this.dealNextRoom();
            else {
                this.phase = 'choose';
                this.status = '←→ 選牌　Enter 確定';
                this.draw();
            }
        });
    }

    dealNextRoom() {
        if (this.disposed) return;
        const next = copyState(this.state);
        const base = next.room.length;
        const arrivals = beginNextRoom(next);
        this.state = next;
        // Draw from the new state with the arrivals hidden as empty slots, the
        // same way the initial deal works. Using the pre-refill state here would
        // leave the incoming cards only in the flight overlay; once it lands
        // they vanish because the main buffer never rendered them.
        this.visualState = null;
        this.phase = 'dealing';
        this.dealing = true;
        this.status = '補充房間…';
        if (!arrivals.length) {
            this.visualState = null;
            this.dealing = false;
            this.cursor = Math.min(this.cursor, Math.max(0, this.state.room.length - 1));
            this.phase = 'choose';
            this.status = '←→ 選牌　Enter 確定';
            this.draw();
            return;
        }
        const hidden = new Set(arrivals.map((_, index) => base + index));
        this.hiddenRoom = hidden;
        this.draw();
        const batch = this.batch;
        const active = () => !this.disposed && batch === this.batch;
        staggerFlights(this.anims, {
            count: arrivals.length,
            isActive: active,
            start: (index, { onStep, onLand }) => dealCard(
                this.cmd, arrivals[index], DECK, roomPosition(base + index), { onStep }, onLand,
            ),
            land: index => {
                this.hiddenRoom.delete(base + index);
                this.draw();
            },
            done: () => {
                if (!active()) return;
                this.visualState = null;
                this.dealing = false;
                this.hiddenRoom.clear();
                this.cursor = Math.min(this.cursor, Math.max(0, this.state.room.length - 1));
                this.phase = 'choose';
                this.status = '←→ 選牌　Enter 確定';
                this.draw();
            },
        });
    }

    showEffect(text, done) {
        const cancel = showEffectBox(this.cmd, text, () => {
            this.cancelEffect = null;
            done();
        });
        this.cancelEffect = cancel;
    }

    enterSettlement() {
        if (this.disposed) return;
        this.phase = this.state.phase;
        this.status = '';
        this.draw();
    }

    openResultDialog() {
        this.dialog = this.cmd.openDialog(SelectDialog, 'scoundrel-result', {
            layout: 'list', title: 'Scoundrel — 結算', width: 30,
            options: ['新遊戲', '回選單'], selectedIndex: 0,
            onSelect: index => {
                this.dialog = null;
                if (index === 0) this.start();
                else this.cmd._menu();
            },
            onCancel: () => { this.dialog = null; this.draw(); },
            onAbort: () => this.cmd._quit(),
        });
    }

    showRules() {
        const message = [
            'Scoundrel 是單人地城牌戲：走完 44 張牌的地城且血量不歸零即勝。',
            '',
            '牌庫：♠♣ 共 26 張怪獸、♦2–10 共 9 張武器、♥2–10 共 9 張藥水。',
            '點數：2–10 為面值，J/Q/K = 11/12/13，A = 14。起始血量 20，上限 20。',
            '',
            '房間：每次翻 4 張，必須處理 3 張，剩下 1 張留到下一間再補 3 張。',
            '牌庫見底時把剩餘的牌打完。',
            '逃離：房間 4 張都還在、且上一間沒有逃離時，可選最右側「逃」框。',
            '逃離會把這 4 張牌放回地城牌堆底，重新發 4 張；不能連續逃離兩間。',
            '',
            '武器（♦）：取得就強制替換舊武器（舊武器與戰利品進棄牌堆）。',
            '打怪時扣「怪獸點數 − 武器威力」的血量，不足的部分才由你承受。',
            '武器殺過怪獸後只能再打點數 ≤ 上次擊殺的怪獸；仍可改為空手。',
            '',
            '藥水（♥）：回復點數血量，不超過 20；每間房只有第一張有效。',
            '喝過之後，房間裡剩餘的藥水牌花色會變灰，表示已無療效。',
            '怪獸（♠♣）：空手承受完整點數傷害，或用可用武器減傷。',
            '',
            '勝利分數 = 剩餘血量；血量歸零即失敗，分數 0。',
            '剩餘怪獸總值僅供參考，不計入分數。',
            '',
            '←→ 選牌　Enter 確定　H 規則　N 選單　Q／Esc 離開',
            '結算畫面按 Enter 可選新遊戲或回選單。',
        ].join('\n');
        this.dialog = this.cmd.openDialog(ShowDialog, 'scoundrel-rules', {
            title: 'Scoundrel — 規則', width: 72,
            message, footer: 'PgUp/PgDn 捲動　Enter / Esc 返回',
            onExit: () => { this.dialog = null; this.draw(); },
            onAbort: () => this.cmd._quit(),
        });
    }

    stopAnimations() {
        this.batch++;
        for (const cancel of this.anims) cancel();
        this.anims.clear();
        this.cancelEffect?.();
        this.cancelEffect = null;
        this.animating = false;
        this.dealing = false;
        this.hiddenRoom.clear();
    }

    dispose() {
        if (this.disposed) return;
        this.stopAnimations();
        this.disposed = true;
        if (this.dialog) {
            this.dialog.close();
            this.dialog = null;
        }
        this.visualState = null;
        this.state = null;
        this.cmd = null;
    }
}
