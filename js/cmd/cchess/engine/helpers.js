export const opp = color => color === 'red' ? 'black' : 'red';
export const movesEqual = (a, b) => a.from.row === b.from.row && a.from.col === b.from.col && a.to.row === b.to.row && a.to.col === b.to.col;
export const inPalace = (row, col, color) => col >= 3 && col <= 5 && (color === 'red' ? row >= 7 && row <= 9 : row >= 0 && row <= 2);
export const onOwnSide = (row, color) => color === 'red' ? row >= 5 : row <= 4;
