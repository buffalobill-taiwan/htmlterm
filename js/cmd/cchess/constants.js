export const BOARD_X = 2, BOARD_Y = 1, BOARD_W = 38, BOARD_H = 21;
export const SIDE_X = 42, SIDE_W = 36;
export const DEPTHS = { easy: 1, medium: 2, hard: 4 };
export const THINK_MS = 3000, BLINK_MS = 100, STEP_MS = 50;
export const INITIAL_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
export const boardX = col => 2 + col * 4;
export const boardY = row => 1 + row * 2;
