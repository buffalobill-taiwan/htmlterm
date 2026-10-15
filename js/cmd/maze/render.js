import { VirtualBuffer } from '../../util/VirtualBuffer.js';
import { makeCell } from '../../util/sgr.js';
import { term } from '../../system/sys.js';
import { isVisible } from './board.js';

const BLANK = makeCell(' ', 7, 0, false);
const TILES = {
    fog: [makeCell('░', 238, 0, false), makeCell('░', 238, 0, false)],
    wall: [makeCell('█', 245, 245, false), makeCell('█', 245, 245, false)],
    floor: [makeCell(' ', 7, 234, false), makeCell(' ', 7, 234, false)],
    trail: [makeCell('．', 226, 234, false, 2), makeCell(' ', 226, 234, false, 0)],
    trailStart: [makeCell('．', 15, 21, false, 2), makeCell(' ', 15, 21, false, 0)],
    player: [makeCell('＠', 0, 226, true, 2), makeCell(' ', 0, 226, false, 0)],
    start: [makeCell(' ', 15, 21, false), makeCell(' ', 15, 21, false)],
    exit: [makeCell(' ', 0, 82, false), makeCell(' ', 0, 82, false)],
    playerStart: [makeCell('＠', 15, 21, true, 2), makeCell(' ', 15, 21, false, 0)],
    playerExit: [makeCell('＠', 0, 82, true, 2), makeCell(' ', 0, 82, false, 0)],
};

export function initView(game) {
    game._viewWidth = Math.min(40, game._width);
    game._root = new VirtualBuffer(80, 25);
    game._board = new VirtualBuffer(game._viewWidth * 2, game._height);
    const slot = game._root.addChildSlot();
    slot.vb = game._board;
    slot.x = Math.floor((80 - game._board.width) / 2);
    slot.y = 2;
    slot.active = true;
}

export function render(game) {
    const { _root: root, _board: board, _width: width, _height: height, _x: px, _y: py } = game;
    for (let y = 0; y < 25; y++)
        for (let x = 0; x < 80; x++) root.setCell(y, x, BLANK);
    const left = game._won ? game._revealLeft
        : Math.max(0, Math.min(width - game._viewWidth, px - Math.floor(game._viewWidth / 2)));
    root.centerRow(0, `Maze 迷宮  ${game._difficulty} ${width}x${height}  Seed ${game._seed}  步數 ${game._steps}`);
    root.centerRow(1, `位置 (${px + 1},${py + 1}) → 終點 (${width},${height})  視窗 ${left + 1}–${left + game._viewWidth}`);
    for (let y = 0; y < height; y++) {
        for (let vx = 0; vx < game._viewWidth; vx++) {
            const x = left + vx;
            let tile = TILES.fog;
            if (game._won || isVisible(game._walls, width, px, py, x, y)) {
                tile = game._walls[y * width + x] ? TILES.wall : TILES.floor;
            }
            const start = x === 0 && y === 0;
            const exit = x === width - 1 && y === height - 1;
            if (start) tile = TILES.start;
            if (exit) tile = TILES.exit;
            if ((game._won || game._breadcrumbs) && game._visited[y * width + x]) tile = start ? TILES.trailStart : TILES.trail;
            if (x === px && y === py) tile = start ? TILES.playerStart : exit ? TILES.playerExit : TILES.player;
            board.setCell(y, vx * 2, tile[0]);
            board.setCell(y, vx * 2 + 1, tile[1]);
        }
    }
    root.centerRow(22, game._won ? '抵達終點！迷宮已全開  ．走過的路' : '＠ 玩家  藍底 起點  綠底 終點  █ 牆  ░ 遮蔽（三格視野）');
    root.centerRow(23, game._won
        ? (width > game._viewWidth ? '← → / A D 查看迷宮   ' : '') + 'R 重走   N 新局   Q / Esc 離開'
        : '方向鍵 / WASD 移動   R 重走   N 新局   Q / Esc 離開');
    term.writeVB(root);
}
