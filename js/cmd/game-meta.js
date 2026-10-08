/**
 * Shared command metadata for lazy-loaded games.
 * Cmd classes import these for static getters; js/cmd/index.js uses them for
 * registration without importing the game implementation modules.
 */
export const GAME_META = {
    '2048': {
        commandName: '2048',
        help: 'Play 2048',
        menu: '2048',
        usage: '2048',
    },
    cchess: {
        commandName: 'cchess',
        help: 'Play Chinese chess or endgame puzzles',
        menu: '中國象棋',
        usage: 'cchess',
    },
    gweled: {
        commandName: 'gweled',
        help: 'Play Gweled',
        menu: 'Gweled',
        usage: 'gweled [--easy|--medium|--hard]',
    },
    jpmj: {
        commandName: 'jpmj',
        help: 'Japanese Mahjong (14 tiles, 6 AI types)',
        menu: 'Japanese Mahjong',
        usage: 'jpmj',
    },
    klotski: {
        commandName: 'klotski',
        help: 'Play Klotski 華容道',
        menu: 'Klotski 華容道',
        usage: 'klotski',
    },
    memory: {
        commandName: 'memory',
        help: 'Play a card-matching Memory game',
        menu: 'Memory',
        usage: 'memory [--easy|--medium|--hard]',
    },
    minesw: {
        commandName: 'minesw',
        help: 'Play Minesweeper',
        menu: 'Minesweeper',
        usage: 'minesw [seed] [--easy|--medium|--hard] [--seed N] [--start R,C]\n' +
            '         Seed: 0–2147483647; seed alone defaults to Medium.\n' +
            '         Start: zero-based row,col; press Enter there to replay.',
    },
    nurikabe: {
        commandName: 'nurikabe',
        help: 'Play Nurikabe',
        menu: 'Nurikabe',
        usage: 'nurikabe [--easy|--medium|--hard] [<seed> [<size>]]',
    },
    othello: {
        commandName: 'othello',
        help: 'Play Othello (Reversi)',
        menu: 'Othello',
        usage: 'othello [--easy|--medium|--hard]',
    },
    puyo: {
        commandName: 'puyo',
        help: 'Play Puyo Puyo',
        menu: 'Puyo Puyo',
        usage: 'puyo [--easy|--medium|--hard]',
    },
    snake: {
        commandName: 'snake',
        help: 'Play Snake (Nokia style)',
        menu: 'Snake',
        usage: 'snake [--easy|--medium|--hard]',
    },
    sudoku: {
        commandName: 'sudoku',
        help: 'Play Sudoku puzzle',
        menu: 'Sudoku Puzzle',
        usage: 'sudoku [seed] [--easy|--medium|--hard] [--seed N]\n' +
            '         Seed: 0–2147483647; seed alone defaults to Medium.',
    },
    tetris: {
        commandName: 'tetris',
        help: 'Play Tetris',
        menu: 'Tetris',
        usage: 'tetris [--easy|--medium|--hard]',
    },
    wordle: {
        commandName: 'wordle',
        help: 'Play Wordle — guess the 5-letter word',
        menu: 'Wordle',
        usage: 'wordle',
    },
};
