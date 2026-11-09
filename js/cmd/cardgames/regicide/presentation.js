import { term } from '../../../system/sys.js';
import { callEffectOverlay, callEffectSize } from '../../../util/call-effect.js';

export function snapshotPiles(state) {
    return { deckCount: state.deck.length,
        discardCount: state.discard.length, discardTop: state.discard.at(-1) ?? null };
}

export const presentationMethods = {
    // Transient presentation state that start() resets between games.
    resetPresentation() {
        this.attackEffect = null;
        this.displayHp = null;
        this.defeatEffect = null;
        this.usedDisplay = null;
        this.displayEnemy = null;
        this.enemyCleared = false;
        this.rosterHold = false;
    },
    clearEvent() {
        clearTimeout(this.eventTimer); this.eventTimer = null;
        if (this.eventOverlay) term.removeOverlay(this.eventOverlay);
        this.eventOverlay = null;
        this.eventCleanup?.(); this.eventCleanup = null;
    },
    showEvent(text, done) {
        this.clearEvent();
        const batch = this.batch, active = this.cmd.executionGuard();
        const { w, h } = callEffectSize(text);
        this.dealing = true;
        this.eventOverlay = callEffectOverlay(text,
            { x: Math.floor((80 - w) / 2), y: Math.floor((25 - h) / 2), owner: this.cmd });
        term.addOverlay(this.eventOverlay);
        this.eventCleanup = this.cmd.addCleanup(() => this.clearEvent());
        this.eventTimer = setTimeout(() => {
            this.clearEvent();
            if (this.disposed || batch !== this.batch || !active()) return;
            this.dealing = false; done(); this.draw();
        }, 800);
        this.draw();
    },
    // Persistent call-effect box used across a whole defeat sequence.
    showBanner(text) {
        this.hideBanner();
        const { w, h } = callEffectSize(text);
        this.bannerOverlay = callEffectOverlay(text,
            { x: Math.floor((80 - w) / 2), y: Math.floor((25 - h) / 2), owner: this.cmd });
        term.addOverlay(this.bannerOverlay);
        this.bannerCleanup = this.cmd.addCleanup(() => this.hideBanner());
        this.draw();
    },
    hideBanner() {
        if (this.bannerOverlay) term.removeOverlay(this.bannerOverlay);
        this.bannerOverlay = null;
        this.bannerCleanup?.(); this.bannerCleanup = null;
    },
    clearEffectPhase() {
        const phase = this.effectPhase;
        if (!phase) return;
        this.effectPhase = null;
        clearTimeout(phase.timer);
        phase.removeCleanup?.();
        this.hideBanner();
    },
    // Both the animation and the minimum reading time must finish before advancing.
    runEffectPhase(text, animate, next) {
        this.clearEffectPhase();
        const phase = { timer: null, elapsed: false, animated: false, removeCleanup: null };
        const active = this.cmd.executionGuard(), batch = this.batch;
        this.effectPhase = phase;
        this.dealing = true;
        const finish = () => {
            if (this.effectPhase !== phase || !active() || this.disposed || batch !== this.batch) return;
            if (!phase.elapsed || !phase.animated) return;
            this.clearEffectPhase();
            next();
        };
        phase.removeCleanup = this.cmd.addCleanup(() => this.clearEffectPhase());
        this.showBanner(text);
        phase.timer = setTimeout(() => { phase.elapsed = true; finish(); }, 1000);
        animate(() => { phase.animated = true; finish(); });
    },
};
