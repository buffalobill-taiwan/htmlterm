import path from 'node:path';

export const ENDGAME_FILE = /^[a-z0-9-]+\.json$/;

// Consume `--output <directory>` from args, leaving any trailing file list.
export function parseOutput(args, usage) {
    const option = args.indexOf('--output');
    if (option < 0 || !args[option + 1]) throw new Error(usage);
    const directory = path.resolve(args[option + 1]);
    args.splice(option, 2);
    return directory;
}
