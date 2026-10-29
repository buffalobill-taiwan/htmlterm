import { term } from '../../../system/sys.js';
import { VirtualBuffer } from '../../../util/VirtualBuffer.js';
import { parseSeed } from '../../../util/random.js';
import { InputDialog } from '../../../dialog/InputDialog.js';
import { ConfirmDialog } from '../../../dialog/ConfirmDialog.js';
import { clone, auto, solved } from './engine.js';
import { moveCards, selectedCards } from './rules.js';
import { drawBoard, hitTest, drawGhost } from './view.js';

export class FreeCellGame {
    constructor(cmd) {
        this.cmd = cmd;
        this.vb = new VirtualBuffer(80, 25);
        this.scroll = Array(8).fill(0);
        this.cursor = { zone: 'column', index: 0, card: 0 };
        this.history = [];
        this.status = '';
    }
    start(seed = Math.floor(Math.random() * 0x80000000)) {
        this.cancelDrag();
        this.worker?.terminate();
        this.state = null; this.selected = null; this.seed = seed; this.history = [];
        this.status = '正在生成並驗證可解牌局…'; this.draw();
        let worker;
        try { worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }); }
        catch { this.status = '無法啟動生成器；M 返回選單'; this.draw(); return; }
        this.worker = worker;
        const fail = () => {
            if (this.worker !== worker) return;
            worker.terminate(); this.worker = null;
            this.status = '生成失敗，請按 N 更換種子或 M 返回選單'; this.draw();
        };
        worker.onerror = fail;
        worker.onmessage = ({ data }) => {
            if (this.worker !== worker || this.disposed) return;
            if (data.error) return fail();
            worker.terminate(); this.worker = null;
            this.initial = data.board;
            this.restart();
        };
        worker.postMessage(seed);
    }
    restart() {
        this.cancelDrag();
        this.state = clone(this.initial); auto(this.state);
        this.history = []; this.selected = null; this.scroll.fill(0);
        this.cursor = { zone: 'column', index: 0, card: 0 };
        this.status = '選擇牌，再選擇目的地；也可用滑鼠拖曳'; this.draw();
    }
    draw() { if (!this.disposed) drawBoard(this); }
    ensureVisible() {
        const c = this.cursor;
        if (!this.state || c.zone !== 'column') return;
        const n = this.state.columns[c.index].length;
        c.card = Math.max(0, Math.min(c.card, n - 1));
        this.scroll[c.index] = Math.max(0, Math.min(this.scroll[c.index], Math.max(0, n - 14)));
        if (c.card < this.scroll[c.index]) this.scroll[c.index] = c.card;
        const room = c.card === n - 1 ? 13 : 15;
        if (c.card > this.scroll[c.index] + room) this.scroll[c.index] = c.card - room;
    }
    select(ref) {
        if (!selectedCards(this.state, ref).length) {
            this.status = '此處沒有可移動的連續牌列'; return false;
        }
        this.selected = { ...ref }; this.status = '選擇目的地，Enter 放牌；Space 取消'; return true;
    }
    move(to) {
        try {
            const next = moveCards(this.state, this.selected, to);
            this.history.push({ state: this.state, cursor: { ...this.cursor }, scroll: [...this.scroll] });
            this.state = next; this.selected = null;
            this.cursor = { ...to, card: to.zone === 'column' ? Math.max(0, next.columns[to.index].length - 1) : 0 };
            this.status = solved(next) ? '恭喜完成！U 悔棋、R 重玩、N 新局' : '已移牌（安全的牌會自動收至右上方）';
            this.ensureVisible(); return true;
        } catch (error) { this.status = error.message; return false; }
    }
    confirm(action) {
        this.cancelDrag();
        if (!this.history.length) return action();
        this.cmd._dialog = this.cmd.openDialog(ConfirmDialog, 'freecell-confirm', {
            title: 'FreeCell', message: '放棄目前進度？', selectedIndex: 1,
            confirmLabel: '確定', cancelLabel: '取消',
            onConfirm: () => { this.cmd._dialog = null; action(); },
            onCancel: () => { this.cmd._dialog = null; this.draw(); },
        });
    }
    askSeed() {
        this.cancelDrag();
        this.cmd._dialog = this.cmd.openDialog(InputDialog, 'freecell-seed', {
            title: 'FreeCell 新局', width: 54, prompt: '種子 0–2147483647（留白隨機）',
            onConfirm: text => {
                this.cmd._dialog = null;
                const seed = text.trim() === '' ? undefined : parseSeed(text.trim());
                if (seed === null) { this.status = '種子須為 0–2147483647 的整數；按 N 重試'; this.draw(); }
                else this.start(seed);
            },
            onCancel: () => { this.cmd._dialog = null; this.draw(); },
        });
    }
    key(data) {
        if (data === '\x1B' || data === ' ') {
            if (this.drag || this.selected) { this.cancelDrag(); this.selected = null; this.status = '已取消選牌'; this.draw(); return; }
            if (data === ' ') return;
        }
        if (/^[qQ]$/.test(data) || data === '\x1B') return this.confirm(() => this.cmd._quit());
        if (/^[mM]$/.test(data)) return this.confirm(() => this.cmd._menu());
        if (/^[nN]$/.test(data)) return this.confirm(() => this.askSeed());
        if (!this.state || this.drag) return;
        if (/^[rR]$/.test(data)) return this.confirm(() => this.restart());
        if (/^[uU]$/.test(data)) {
            const old = this.history.pop();
            if (old) { this.state = old.state; this.cursor = old.cursor; this.scroll = old.scroll; }
            this.selected = null; this.status = old ? '已悔棋（含自動收牌）' : '沒有可悔棋的步驟'; this.draw(); return;
        }
        const c = this.cursor;
        if (data === '\r' || data === '\n') {
            if (this.selected) this.move(c); else this.select(c);
        } else if (data === '\x1B[C' || data === '\x1B[D') {
            const delta = data.endsWith('C') ? 1 : -1;
            if (c.zone === 'column') c.index = (c.index + delta + 8) % 8;
            else {
                const slot = (c.index + (c.zone === 'foundation' ? 4 : 0) + delta + 8) % 8;
                c.zone = slot < 4 ? 'cell' : 'foundation'; c.index = slot % 4;
            }
        } else if (data === '\x1B[A') {
            if (c.zone === 'column' && c.card > 0) c.card--;
            else if (c.zone === 'column') { c.zone = c.index < 4 ? 'cell' : 'foundation'; c.index %= 4; }
        } else if (data === '\x1B[B') {
            if (c.zone !== 'column') { c.index += c.zone === 'foundation' ? 4 : 0; c.zone = 'column'; c.card = 0; }
            else c.card++;
        } else if (c.zone === 'column' && ['\x1B[H','\x1B[1~','\x1B[7~','\x1BOH'].includes(data)) c.card = 0;
        else if (c.zone === 'column' && ['\x1B[F','\x1B[4~','\x1B[8~','\x1BOF'].includes(data)) c.card = this.state.columns[c.index].length - 1;
        else if (c.zone === 'column' && data === '\x1B[5~') c.card -= 12;
        else if (c.zone === 'column' && data === '\x1B[6~') c.card += 12;
        else return;
        this.ensureVisible(); this.draw();
    }
    scrollColumn(index, delta) {
        const max = Math.max(0, this.state.columns[index].length - 14);
        const next = Math.max(0, Math.min(max, this.scroll[index] + delta));
        if (next === this.scroll[index]) return;
        this.scroll[index] = next;
        this.draw();
    }
    handleMouse(type, info) {
        if (type === 'cancel') { this.cancelDrag(); this.draw(); return true; }
        if (!this.state || this.disposed) return false;
        if (type === 'mousedown') {
            if (info.btn !== 0) return false;
            const hit = hitTest(this, info.col, info.row);
            if (!hit || hit.emptyArea) return false;
            if (hit.scroll) { this.scrollColumn(hit.index, hit.scroll); return true; }
            this.cursor = hit; this.selected = null;
            if (!this.select(hit)) { this.draw(); return true; }
            this.drag = { from: { ...hit }, col: info.col, row: info.row };
            const vb = drawGhost(selectedCards(this.state, hit));
            this.ghost = { x: info.col, y: info.row, w: 5, h: vb.height, owner: null, getCell: (r, c) => vb.getCell(r, c) };
            term.addOverlay(this.ghost);
            this.edgeTimer = setInterval(() => {
                if (!this.drag) return;
                const target = hitTest(this, this.drag.col, this.drag.row);
                if (target?.zone === 'column' && (this.drag.row <= 7 || this.drag.row >= 20))
                    this.scrollColumn(target.index, this.drag.row <= 7 ? -1 : 1);
            }, 150);
            this.draw(); return true;
        }
        if (!this.drag) return false;
        if (type === 'mousemove') {
            this.dirtyGhost();
            this.drag.col = info.col; this.drag.row = info.row;
            this.ghost.x = info.col; this.ghost.y = info.row;
            this.dirtyGhost(); return true;
        }
        if (type === 'mouseup') {
            const target = hitTest(this, info.col, info.row);
            if (target && !target.scroll) this.move(target);
            else this.status = '已取消拖曳';
            this.cancelDrag(); this.draw(); return true;
        }
        return false;
    }
    dirtyGhost() {
        if (this.ghost) for (let r = Math.max(0, this.ghost.y); r < Math.min(25, this.ghost.y + this.ghost.h); r++) term.markRowDirty(r);
    }
    cancelDrag() {
        clearInterval(this.edgeTimer); this.edgeTimer = null;
        if (this.ghost) { this.dirtyGhost(); term.removeOverlay(this.ghost); this.ghost = null; }
        if (this.drag) this.selected = null;
        this.drag = null;
    }
    dispose() {
        this.cancelDrag(); this.worker?.terminate(); this.worker = null; this.disposed = true;
    }
}
