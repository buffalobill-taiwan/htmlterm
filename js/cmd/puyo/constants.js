const COLS = 6;

const ROWS = 12;

const LOCK_DELAY = 400;

const FLASH_STEP_MS = 80;

const FLASH_CYCLES = 6;

const FALL_DELAY = 250;

const FALL_STEP_MS = 40;

const BOARD_W = COLS * 2 + 2;

const BOARD_H = ROWS + 2;

const BOARD_X = 2;

const BOARD_Y = 1;

const SIDEBAR_X = 30;

const SIDEBAR_W = 50;

const DIFFICULTY = {
    easy:   { colors: 3, gravity: 900, label: 'Easy' },
    medium: { colors: 4, gravity: 650, label: 'Medium' },
    hard:   { colors: 5, gravity: 450, label: 'Hard' },
};

const DIRS = [[0, 1], [0, -1], [1, 0], [-1, 0]];

// Tail offset from the pivot (top/left puyo) per rotation state.
const TAIL = [[0, 1], [1, 0], [0, -1], [-1, 0]];

// Wall kicks tried in order when a rotation would collide.
const KICKS = [[0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1]];

export {
    SIDEBAR_W, BOARD_H, BOARD_W, BOARD_X, BOARD_Y, SIDEBAR_X, DIFFICULTY, ROWS, COLS, TAIL, DIRS,
    KICKS, FALL_STEP_MS, FLASH_CYCLES, FLASH_STEP_MS, FALL_DELAY, LOCK_DELAY,
};
