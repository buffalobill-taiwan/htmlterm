import { SEED_MAX } from '../../util/random.js';

const SIZE = 9;

const BOX = 3;

const DIFFICULTY = {
    easy:   { hints: 36, label: 'Easy' },
    medium: { hints: 30, label: 'Medium' },
    hard:   { hints: 24, label: 'Hard' },
};

const BOARD_W = 39;

const BOARD_H = 19;

const SIDEBAR_W = 7;

const BOARD_X = 0;

const SIDEBAR_X = 41;

const GRID_Y = 1;

export { SIZE, SEED_MAX, DIFFICULTY, BOARD_W, BOARD_H, SIDEBAR_W, BOARD_X, GRID_Y, SIDEBAR_X, BOX };
