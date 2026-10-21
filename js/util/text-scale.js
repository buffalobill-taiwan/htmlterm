// Command-facing scale range; SGR 500 remains the legacy twofold alias.
export const MAX_TEXT_SCALE = 10;

export function textScaleFlag(arg) {
    if (arg === '--big') return 2;
    if (!arg || !arg.startsWith('--x')) return null;
    if (!/^--x[1-9][0-9]*$/.test(arg)) return 0;
    const scale = Number(arg.slice(3));
    return scale >= 2 && scale <= MAX_TEXT_SCALE ? scale : 0;
}

export function textScaleSGR(scale) {
    return `\x1B[${500 + scale}m`;
}
