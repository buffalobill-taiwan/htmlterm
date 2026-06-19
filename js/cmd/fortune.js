class Fortune extends CmdBase {
    execute(args) {
        const fortunes = [
            'A terminal emulator is never late, nor is it early.\nIt renders precisely when it means to.',
            '42 is the answer. But what was the question again?',
            'The Endless Loop: n.; see Loop, Endless.\nLoop, Endless: n.; see Endless Loop.',
            'In a world of GUIs, be a terminal.',
            'There is no place like ~',
            'Have you tried turning it off and on again?',
            '> make me a sandwich\n  What? I don\'t know how to make a sandwich.\n  > sudo make me a sandwich\n  Okay.',
            'A journey of a thousand miles begins with\na single step. Or a single keystroke.',
            '\u5343\u91CC\u4E4B\u884C\uFF0C\u59CB\u65BC\u8DB3\u4E0B\u3002',
            '\u5B66\u800C\u4E0D\u601D\u5247\u7F60\uFF0C\u601D\u800C\u4E0D\u5B66\u5247\u6B86\u3002',
            '\u5DF1\u6240\u4E0D\u6B32\uFF0C\u52FF\u65BD\u65BC\u4EBA\u3002',
            '\u6EAB\u6545\u800C\u77E5\u65B0\uFF0C\u53EF\u4EE5\u70BA\u5E2B\u77E3\u3002',
            '\u4E09\u4EBA\u884C\uFF0C\u5FC5\u6709\u6211\u5E2B\u7109\u3002',
            '\u5929\u884C\u5065\uFF0C\u541B\u5B50\u4EE5\u81EA\u5F3A\u4E0D\u606F\u3002',
            '\u4E0D\u4EE5\u7269\u559C\uFF0C\u4E0D\u4EE5\u5DF1\u60B2\u3002',
            '\u4EBA\u751F\u5982\u9006\u65C5\uFF0C\u6211\u4EA6\u662F\u884C\u4EBA\u3002',
            '\u751F\u6D3B\u5C31\u50CF\u6D77\u6D0B\uFF0C\u53EA\u6709\u610F\u5FD7\u5805\u5F37\u7684\u4EBA\u624D\u80FD\u5230\u9054\u5F7C\u5CB8\u3002',
            '\u4E03\u8ECA\u3073\u516B\u8D77\u304D\u308A\u3000\u2014\u3000Fall seven times, stand up eight.',
            '\u733F\u3082\u6728\u304B\u3089\u843D\u3061\u308B\u3000\u2014\u3000Even monkeys fall from trees.',
            '\u7D99\u7D9A\u306F\u529B\u306A\u308A\u3000\u2014\u3000Persistence is power.',
            '\u82B1\u3088\u308A\u56E3\u5B50\u3000\u2014\u3000Substance over style.',
            '\u6642\u306F\u91D1\u306A\u308A\u3000\u2014\u3000Time is money.',
            '\u6025\u304C\u3070\u56DE\u308C\u3000\u2014\u3000If in a hurry, take the long way.',
            '\u90F7\u306B\u5165\u3063\u3066\u306F\u90F7\u306B\u5F93\u3048\u3000\u2014\u3000When in Rome, do as the Romans do.',
            '\u660E\u65E5\u306F\u660E\u65E5\u306E\u98A8\u304C\u5439\u304F\u3000\u2014\u3000Tomorrow\'s wind blows tomorrow.',
            '\u5875\u3082\u7A4D\u3082\u308C\u3070\u5C71\u3068\u306A\u308B\u3000\u2014\u3000Even dust piles into a mountain.',
            '\u864E\u7A74\u306B\u5165\u3089\u305A\u3093\u3070\u864E\u5B50\u3092\u5F97\u305A\u3000\u2014\u3000Nothing ventured, nothing gained.',
        ];
        this.print(fortunes[Math.floor(Math.random() * fortunes.length)] + '\n');
    }
    static get commandName() { return 'fortune'; }
    static get help() { return 'Show a random fortune'; }
    static get menu() { return 'Random Fortune'; }
}
