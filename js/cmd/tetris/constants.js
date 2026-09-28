const COLS = 10;

const ROWS = 20;

const LOCK_DELAY = 500;

const MAX_LOCK_RESETS = 15;

const BASE_GRAVITY_INTERVAL = 800;

const GRAVITY_DECAY = 0.9;

const MIN_GRAVITY_INTERVAL = 40;

const BOARD_W = 22;

const BOARD_H = 22;

const BOARD_X = 2;

const BOARD_Y = 1;

const SIDEBAR_X = 30;

const SIDEBAR_W = 50;

const DIFFICULTY = {
    easy:   { level: 0, label: 'Easy' },
    medium: { level: 5, label: 'Medium' },
    hard:   { level: 9, label: 'Hard' },
};

export {
    SIDEBAR_W, BOARD_H, BOARD_W, SIDEBAR_X, BOARD_Y, BOARD_X, DIFFICULTY, ROWS, COLS,
    MAX_LOCK_RESETS, LOCK_DELAY, MIN_GRAVITY_INTERVAL, BASE_GRAVITY_INTERVAL, GRAVITY_DECAY,
};
