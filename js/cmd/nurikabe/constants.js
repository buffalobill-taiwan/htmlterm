const DIFFICULTY = {
    easy:   { size: 8,  label: 'Easy' },
    medium: { size: 12, label: 'Medium' },
    hard:   { size: 16, label: 'Hard' },
};

const CLUE_CONNECTED = 'connected';

const CLUE_OK = 'ok';

const CLUE_OVER = 'over';

const CLUE_BAD = 'bad';

const MIN_SIZE = 4;

const MAX_SIZE = 18;

const SEED_MAX = 0x7fffffff;

function _sizeLabel(size) {
    if (size === 8) return 'Easy';
    if (size === 12) return 'Medium';
    if (size === 16) return 'Hard';
    return size + '×' + size;
}

export { CLUE_CONNECTED, CLUE_OVER, CLUE_OK, CLUE_BAD, DIFFICULTY, SEED_MAX, MIN_SIZE, MAX_SIZE, _sizeLabel };
