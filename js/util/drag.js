export function startDrag(obj, col, row, x, y) {
    obj._dragOffX = col - x;
    obj._dragOffY = row - y;
}

export function moveDrag({ obj, term, col, row, fromX, fromY, w, h, setPos }) {
    if (obj._dragOffX === undefined) return;
    const newX = Math.max(0, Math.min(term.cols - w, col - obj._dragOffX));
    const newY = Math.max(0, Math.min(term.rows - h, row - obj._dragOffY));
    if (newX !== fromX || newY !== fromY) {
        for (let r = fromY; r < fromY + h; r++) term.markRowDirty(r);
        setPos(newX, newY);
        if (obj._overlay) {
            obj._overlay.x = newX;
            obj._overlay.y = newY;
        }
        for (let r = newY; r < newY + h; r++) term.markRowDirty(r);
    }
}

export function endDrag(obj) {
    obj._dragOffX = undefined;
    obj._dragOffY = undefined;
}

export function markDirtyRows(term, y, h) {
    for (let r = y; r < y + h; r++) term.markRowDirty(r);
}

export function addDragMethods(obj, term, { getX, getY, setX, setY, getW, getH, getOverlay }) {
    obj.startDrag = (col, row) => {
        obj._dragOffX = col - getX();
        obj._dragOffY = row - getY();
    };
    obj.moveDrag = (col, row) => {
        if (obj._dragOffX === undefined) return;
        const newX = Math.max(0, Math.min(term.cols - getW(), col - obj._dragOffX));
        const newY = Math.max(0, Math.min(term.rows - getH(), row - obj._dragOffY));
        if (newX !== getX() || newY !== getY()) {
            for (let r = getY(); r < getY() + getH(); r++) term.markRowDirty(r);
            setX(newX); setY(newY);
            const ov = getOverlay();
            if (ov) {
                ov.x = newX; ov.y = newY;
            }
            for (let r = newY; r < newY + getH(); r++) term.markRowDirty(r);
        }
    };
    obj.endDrag = () => {
        obj._dragOffX = undefined;
        obj._dragOffY = undefined;
    };
}
