export function tokenize(str) {
    const args = [];
    let i = 0;
    while (i < str.length) {
        while (i < str.length && str[i] === ' ') i++;
        if (i >= str.length) break;

        let arg = '';
        while (i < str.length && str[i] !== ' ') {
            const ch = str[i];
            if (ch === '\\') {
                i++;
                if (i < str.length) arg += str[i];
                i++;
            } else if (ch === '\'') {
                i++;
                while (i < str.length && str[i] !== '\'') {
                    arg += str[i];
                    i++;
                }
                if (i < str.length) i++;
            } else if (ch === '"') {
                i++;
                while (i < str.length && str[i] !== '"') {
                    if (str[i] === '\\') {
                        i++;
                        if (i < str.length) {
                            const next = str[i];
                            if (next === '"' || next === '\\' || next === '$' || next === '`') {
                                arg += next;
                            } else {
                                arg += '\\' + next;
                            }
                            i++;
                        }
                    } else {
                        arg += str[i];
                        i++;
                    }
                }
                if (i < str.length) i++;
            } else {
                arg += ch;
                i++;
            }
        }
        args.push(arg);
    }
    return args;
}
