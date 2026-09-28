const COLS = 8;

const ROWS = 8;

const FLASH_STEP_MS = 80;

const FLASH_CYCLES = 6;

const FALL_DELAY = 400;

const FALL_STEP_MS = 70;

const SWAP_BACK_MS = 250;

const AUTO_DELAY_MS = 500;

const BOARD_W = COLS * 2 + 2;

const BOARD_H = ROWS + 2;

const BOARD_X = 13;

const BOARD_Y = 7;

const SIDEBAR_X = 33;

const SIDEBAR_W = 34;

const SIDEBAR_H = 14;

const SIDEBAR_Y = 2;

const DIFFICULTY = {
    easy:   { colors: 5, label: 'Easy' },
    medium: { colors: 6, label: 'Medium' },
    hard:   { colors: 7, label: 'Hard' },
};

const DIRS = [
    { dr: -1, dc: 0 },  // up
    { dr: 1,  dc: 0 },  // down
    { dr: 0,  dc: -1 }, // left
    { dr: 0,  dc: 1 },  // right
];

export {
    ROWS, COLS, SIDEBAR_W, SIDEBAR_H, BOARD_W, BOARD_H, BOARD_X, BOARD_Y, SIDEBAR_X, SIDEBAR_Y,
    DIFFICULTY, SWAP_BACK_MS, AUTO_DELAY_MS, FLASH_CYCLES, FLASH_STEP_MS, FALL_STEP_MS, FALL_DELAY,
    DIRS,
};
