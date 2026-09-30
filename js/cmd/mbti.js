import mbtiData from '../data/mbti.json' with { type: 'json' };
import { term } from '../system/sys.js';
import { CmdBase } from './CmdBase.js';
import { cyan, bold, yellow, white, red, magenta } from '../util/sgr.js';
import { wrapInteractiveFlow } from '../system/InteractiveCommandHelper.js';
import { DimensionalAggregator } from '../system/QuestionnaireHelper.js';
import { shuffle } from '../util/random.js';

export class MbtiCmd extends CmdBase {
    constructor() {
        super();
        this.pools = mbtiData.pools;
    }

    _shuffle(array) {
        return shuffle(array);
    }

    async execute(args) {
        await wrapInteractiveFlow(this, async (cmd) => {
            cmd.print('\r\n' + bold(cyan('=== MBTI 職業性格測驗 (互動版) ===')) + '\r\n');
            cmd.print(yellow('使用 [左/右方向鍵] 切換選項，按 [Enter] 確認選擇，[Ctrl+C] 中斷退出。') + '\r\n\r\n');

            const selected = [
                ...shuffle([...this.pools.EI]).slice(0, 2),
                ...shuffle([...this.pools.SN]).slice(0, 2),
                ...shuffle([...this.pools.TF]).slice(0, 2),
                ...shuffle([...this.pools.JP]).slice(0, 2),
            ];

            this.questions = shuffle(selected);
            this.answers = [];

            for (let i = 0; i < this.questions.length; i++) {
                const q = this.questions[i];
                const shuffled = Math.random() < 0.5;
                const rowOpts = shuffled ? [q.bText, q.aText] : [q.aText, q.bText];

                const result = await cmd.selectAsync({
                    text: bold(cyan(`[問題 ${i + 1}/${this.questions.length}] `)) + bold(white(q.text)) + '\r\n',
                    options: [rowOpts],
                });

                if (!result) {
                    term.write('\r\n' + red('^C 測驗已中斷') + '\r\n');
                    return;
                }

                const answer = shuffled ? (result.col === 0 ? 'B' : 'A') : (result.col === 0 ? 'A' : 'B');
                this.answers.push(answer);
                term.write('\r\n\r\n');
            }

            await this._showResults();
        });
    }

    async _showResults() {
        // Use DimensionalAggregator for scoring
        const agg = new DimensionalAggregator({
            dimensions: ['E/I', 'S/N', 'T/F', 'J/P'],
            scoringMap: {
                'E/I': { A: { key: 'e', weight: 1 }, B: { key: 'i', weight: 1 } },
                'S/N': { A: { key: 's', weight: 1 }, B: { key: 'n', weight: 1 } },
                'T/F': { A: { key: 't', weight: 1 }, B: { key: 'f', weight: 1 } },
                'J/P': { A: { key: 'j', weight: 1 }, B: { key: 'p', weight: 1 } },
            }
        });

        for (let idx = 0; idx < this.answers.length; idx++) {
            const ans = this.answers[idx];
            const q = this.questions[idx];
            agg.recordAnswer(q.dim, ans);
        }

        const mbti = agg.getFinalResult(['E/I', 'S/N', 'T/F', 'J/P']);

        const profiles = mbtiData.profiles;

        const profile = profiles[mbti] || { title: '未知類型', desc: '無法取得對應的 MBTI 描述。' };

        this.print(bold(yellow('==================================================')) + '\r\n');
        this.print(bold(cyan('              MBTI 職業性格測試結果')) + '\r\n');
        this.print(bold(yellow('==================================================')) + '\r\n');
        this.print(`  您的 MBTI 類型是：${bold(magenta(mbti))} (${bold(white(profile.title))})\r\n\r\n`);
        this.print(`  ${bold(white('[性格解析]'))}\r\n`);
        this.print(`  ${profile.desc}\r\n`);
        this.print(bold(yellow('==================================================')) + '\r\n\r\n');

        await this.waitForPrint();
    }

    static get commandName() { return 'mbti'; }
    static get help() { return 'MBTI personality test (interactive)'; }
    static get menu() { return 'MBTI Personality Test'; }
    static get usage() { return 'mbti'; }
}
