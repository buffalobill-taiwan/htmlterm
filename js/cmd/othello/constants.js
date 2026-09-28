const EMPTY = 0;

const BLACK = 1;

const WHITE = 2;

const N = 8;

const DIRS = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1],
];

const DIFFICULTY = {
    easy:   { label: 'Easy' },
    medium: { label: 'Medium' },
    hard:   { label: 'Hard' },
};

const FLIP_MS = 150;

const THINK_MS = 150;

const BLINK_MS = 150;

const PASS_MS = 700;

const GRID_X = 31;

const GRID_Y = 4;

const BOARD_W = 18;

const BOARD_H = 10;

const STATUS_Y = 15;

const FOOTER_Y = 16;

const CLEAR_ROW = 18;

export {
    N, BLACK, WHITE, EMPTY, DIRS, BOARD_W, BOARD_H, GRID_X, GRID_Y, DIFFICULTY, STATUS_Y, FOOTER_Y,
    FLIP_MS, PASS_MS, THINK_MS, BLINK_MS, CLEAR_ROW,
};
