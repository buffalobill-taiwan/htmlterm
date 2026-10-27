const GRID_COLS = 20;

const GRID_ROWS = 16;

const BOARD_W = GRID_COLS * 2 + 2;

const BOARD_H = GRID_ROWS + 2;

const BOARD_X = 2;

const BOARD_Y = 1;

const SIDEBAR_X = BOARD_X + BOARD_W + 2;

const SIDEBAR_W = 32;

const DIR = { UP: 0, RIGHT: 1, DOWN: 2, LEFT: 3 };

const DX = [0, 1, 0, -1];

const DY = [-1, 0, 1, 0];

const OPPOSITE = [DIR.DOWN, DIR.LEFT, DIR.UP, DIR.RIGHT];

const DIFFICULTY = {
    easy:   { startSpeedLevel: 1, label: 'Easy' },
    medium: { startSpeedLevel: 3, label: 'Medium' },
    hard:   { startSpeedLevel: 7, label: 'Hard' },
};

const SPEED_UP_EVERY = 3;
const SPEED_LEVELS = Array.from({ length: 17 }, (_, i) =>
    Math.max(40, Math.round(200 * 0.9 ** i)));

export {
    BOARD_W, BOARD_H, SIDEBAR_W, BOARD_X, BOARD_Y, SIDEBAR_X, DIFFICULTY, GRID_COLS, GRID_ROWS,
    DIR, SPEED_LEVELS, SPEED_UP_EVERY, OPPOSITE, DY, DX,
};
