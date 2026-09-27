// RAF-based animation helper with overlay management

import { CURSOR_SHOW, CURSOR_HIDE } from '../util/sgr.js';
import { term } from './sys.js';
import { markDirtyRows } from '../util/drag.js';

/**
 * Manager for RAF-driven animations with overlay compositing.
 */
export class RAFAnimationManager {
    constructor(cmd, options = {}) {
        this.cmd = cmd;
        this.overlay = null;
        this.rafId = null;
        this.isRunning = false;
        this._removeCleanup = null;

        this.options = {
            y: options.y !== undefined ? options.y : 1,
            x: options.x !== undefined ? options.x : 0,
            w: options.w || term.cols,
            h: options.h || (term.rows - 2),
            hideCursor: options.hideCursor !== false,
            holdBusy: options.holdBusy !== false,
            ...options,
        };
    }

    /**
     * Initialize overlay structure.
     * @param {Function} getCell - Function(row, col) -> cell or null
     */
    initOverlay(getCell) {
        this.overlay = {
            y: this.options.y,
            x: this.options.x,
            h: this.options.h,
            w: this.options.w,
            owner: null,
            getCell,
        };
    }

    /**
     * Start the RAF animation loop.
     * @param {Function} updateFn - Function(ts, frameIndex) -> shouldStop
     *   Called per frame. Return false/null to continue, or true to stop.
     * @param {Function} cleanupFn - Called on loop end (abort or stop)
     */
    start(updateFn, cleanupFn) {
        if (this.isRunning) return;

        const isActive = this.cmd.executionGuard();
        this.isRunning = true;

        if (this.options.hideCursor) {
            term.write(CURSOR_HIDE);
        }

        if (this.options.holdBusy) {
            this.cmd.holdBusy();
        }

        if (this.overlay) {
            term.addOverlay(this.overlay);
        }

        this._removeCleanup = this.cmd.addCleanup(() => this.stop(cleanupFn, false));
        if (this.overlay) markDirtyRows(term, this.overlay.y, this.overlay.h);

        let frameIndex = 0;
        let lastFrameTime = 0;
        const frameDuration = this.options.frameDuration || 16;  // ~60fps

        const loop = (ts) => {
            if (!this.isRunning) return;
            const isAborted = !isActive();

            if (!isAborted && ts - lastFrameTime >= frameDuration) {
                const shouldStop = updateFn(ts, frameIndex);
                frameIndex++;
                lastFrameTime = ts;

                if (shouldStop) {
                    this.stop(cleanupFn);
                    return;
                }
            }

            if (isAborted) {
                this.stop(cleanupFn);
            } else {
                this.rafId = requestAnimationFrame(loop);
            }
        };

        this.rafId = requestAnimationFrame(loop);
    }

    /**
     * Stop the animation loop.
     */
    stop(cleanupFn, releaseBusy = true) {
        if (!this.isRunning) return;

        this.isRunning = false;
        this._removeCleanup?.();
        this._removeCleanup = null;

        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }

        if (this.overlay) {
            term.removeOverlay(this.overlay);
            markDirtyRows(term, this.overlay.y, this.overlay.h);
        }

        if (this.options.hideCursor) {
            term.write(CURSOR_SHOW);
        }

        if (releaseBusy && this.options.holdBusy) {
            this.cmd.releaseBusy();
        }

        if (cleanupFn) {
            cleanupFn();
        }
    }
}

/**
 * Simplified function-based RAF animation.
 * @param {CmdBase} cmd - Command instance
 * @param {Function} getCell - Overlay getCell function
 * @param {Function} updateFn - Function(ts, frameIndex) -> shouldStop
 * @param {Object} options - Animation options (y, x, w, h, hideCursor, holdBusy)
 */
export function startBufferAnimation(cmd, getCell, updateFn, options = {}) {
    const manager = new RAFAnimationManager(cmd, options);
    manager.initOverlay(getCell);

    const cleanup = options.onCleanup || (() => {});
    manager.start(updateFn, cleanup);

    return manager;
}
