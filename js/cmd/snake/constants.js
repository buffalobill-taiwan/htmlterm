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
    easy:   { startSpeed: 200, speedUpEvery: 8,  label: 'Easy' },
    medium: { startSpeed: 170, speedUpEvery: 5,  label: 'Medium' },
    hard:   { startSpeed: 130, speedUpEvery: 3,  label: 'Hard' },
};

const SPEED_LEVELS = [200, 180, 160, 140, 120, 100, 80, 65, 50, 40];

export {
    BOARD_W, BOARD_H, SIDEBAR_W, BOARD_X, BOARD_Y, SIDEBAR_X, DIFFICULTY, GRID_COLS, GRID_ROWS,
    DIR, SPEED_LEVELS, OPPOSITE, DY, DX,
};
