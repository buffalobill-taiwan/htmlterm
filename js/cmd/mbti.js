import { InteractiveCmd } from './InteractiveCmd.js';
import { cyan, bold, yellow, white, red, magenta } from '../sgr.js';

export class MbtiCmd extends InteractiveCmd {
    constructor(shell) {
        super(shell);
        this.pools = {
            EI: [
                {
                    text: '在社交聚會中，你通常是：',
                    aText: '活躍並主動與多人交談',
                    bText: '安靜並傾向與熟人聊天',
                    dim: 'E/I'
                },
                {
                    text: '度過忙碌的一週後，你偏向：',
                    aText: '與朋友聚會或參加活動',
                    bText: '獨自留在家中看書休息',
                    dim: 'E/I'
                },
                {
                    text: '工作或學習時，你更喜歡：',
                    aText: '與團隊頻繁交流與討論',
                    bText: '專注獨立思考不受打擾',
                    dim: 'E/I'
                },
                {
                    text: '當遇到開心的事或新計畫時，你通常會：',
                    aText: '立刻與身邊的人分享',
                    bText: '先在心裡默默整理想法',
                    dim: 'E/I'
                }
            ],
            SN: [
                {
                    text: '面對工作任務時，你更關注：',
                    aText: '眼前的具體細節與事實',
                    bText: '未來的宏觀概念與想像',
                    dim: 'S/N'
                },
                {
                    text: '描述一個故事時，你更傾向：',
                    aText: '照實敘述具體發生經過',
                    bText: '解釋其背後感覺與意義',
                    dim: 'S/N'
                },
                {
                    text: '你通常更信任哪種判斷依據？',
                    aText: '親身經驗與過往事實',
                    bText: '直覺靈感與邏輯聯想',
                    dim: 'S/N'
                },
                {
                    text: '閱讀或看電影時，你更喜歡：',
                    aText: '情節寫實且合乎常理',
                    bText: '富含隱喻或超現實情節',
                    dim: 'S/N'
                }
            ],
            TF: [
                {
                    text: '做重大決定時，你通常：',
                    aText: '就事論事理性邏輯分析',
                    bText: '顧及他人感受維護和諧',
                    dim: 'T/F'
                },
                {
                    text: '當朋友向你訴苦時，你會先：',
                    aText: '分析問題核心給予建議',
                    bText: '給予同理與情感支持',
                    dim: 'T/F'
                },
                {
                    text: '與他人觀點爭執時，你傾向：',
                    aText: '堅守事實邏輯即使尷尬',
                    bText: '委婉表達避免產生衝突',
                    dim: 'T/F'
                },
                {
                    text: '你更欣賞別人稱讚你是：',
                    aText: '聰明理性且有條理',
                    bText: '溫暖貼心且有同理心',
                    dim: 'T/F'
                }
            ],
            JP: [
                {
                    text: '面對日常行程，你更偏好：',
                    aText: '制定計劃按部就班推進',
                    bText: '保持彈性隨機應變調整',
                    dim: 'J/P'
                },
                {
                    text: '面對截止日期（Deadline）時：',
                    aText: '提前規劃每天穩步完成',
                    bText: '隨性行事最後關頭爆發',
                    dim: 'J/P'
                },
                {
                    text: '去不熟悉的地方旅行前：',
                    aText: '事先排好詳細景點行程',
                    bText: '大概決定方向隨心探索',
                    dim: 'J/P'
                },
                {
                    text: '如果工作桌面有些凌亂：',
                    aText: '覺得不自在並儘快整理',
                    bText: '覺得無所謂且隨時能找',
                    dim: 'J/P'
                }
            ]
        };
    }

    _shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    execute(args) {
        this.open();
        this.currentIndex = 0;
        this.answers = [];

        this.print('\r\n' + bold(cyan('=== MBTI 職業性格測驗 (互動版) ===')) + '\r\n');
        this.print(yellow('使用 [左/右方向鍵] 切換選項，按 [Enter] 確認選擇，[Ctrl+C] 中斷退出。') + '\r\n\r\n');

        const selected = [
            ...this._shuffle([...this.pools.EI]).slice(0, 2),
            ...this._shuffle([...this.pools.SN]).slice(0, 2),
            ...this._shuffle([...this.pools.TF]).slice(0, 2),
            ...this._shuffle([...this.pools.JP]).slice(0, 2),
        ];

        this.questions = this._shuffle(selected);
        this._askNext();
    }

    _askNext() {
        const q = this.questions[this.currentIndex];
        const shuffled = Math.random() < 0.5;
        const rowOpts = shuffled ? [q.bText, q.aText] : [q.aText, q.bText];

        this.select({
            text: bold(cyan(`[問題 ${this.currentIndex + 1}/8] `)) + bold(white(q.text)) + '\r\n',
            options: [rowOpts],
            onPick: (row, col, value) => {
                const answer = shuffled ? (col === 0 ? 'B' : 'A') : (col === 0 ? 'A' : 'B');
                this.answers.push(answer);
                this.term.write('\r\n\r\n');
                this.currentIndex++;
                if (this.currentIndex < this.questions.length) {
                    this._askNext();
                } else {
                    this.showResults();
                }
            },
        });
    }

    onCancel() {
        this.term.write('\r\n' + red('^C 測驗已中斷') + '\r\n');
        this.close();
    }

    showResults() {
        let e = 0, i = 0, s = 0, n = 0, t = 0, f = 0, j = 0, p = 0;
        for (let idx = 0; idx < this.questions.length; idx++) {
            const q = this.questions[idx];
            const ans = this.answers[idx];
            if (q.dim === 'E/I') {
                if (ans === 'A') e++; else i++;
            } else if (q.dim === 'S/N') {
                if (ans === 'A') s++; else n++;
            } else if (q.dim === 'T/F') {
                if (ans === 'A') t++; else f++;
            } else if (q.dim === 'J/P') {
                if (ans === 'A') j++; else p++;
            }
        }

        const mbti =
            (e >= i ? 'E' : 'I') +
            (s >= n ? 'S' : 'N') +
            (t >= f ? 'T' : 'F') +
            (j >= p ? 'J' : 'P');

        const profiles = {
            INTJ: { title: '建築師 / 策劃者', desc: '獨立、具策略性、完美主義者。擁有強大的邏輯與系統思考能力。' },
            INTP: { title: '邏輯學家 / 學者', desc: '好奇心強、分析力佳、熱愛理論。喜歡探索各種抽象事物的本質。' },
            ENTJ: { title: '指揮官 / 領袖', desc: '果斷、自信、擅長組織與規劃。天生的領導者，擅長帶領團隊實現宏大目標。' },
            ENTP: { title: '辯論家 / 發明家', desc: '機智、喜愛挑戰、點子多。擅長尋求創新的解決方案，樂於與人思辨。' },
            INFJ: { title: '提倡者 / 諮商師', desc: '有理想、同理心強、追求深層意義。溫和而堅定，致力於幫助他人與改善世界。' },
            INFP: { title: '調停者 / 哲學家', desc: '溫和、忠於價值觀、富有想像力。渴望與他人建立深層的精神連結。' },
            ENFJ: { title: '主人公 / 教育家', desc: '熱情、具感染力、關懷他人成長。具備極強的說服力與團隊凝聚力。' },
            ENFP: { title: '競選者 / 公關', desc: '充滿熱情、富有創意、社交能力佳。總是能看到事物的可能性與美好的一面。' },
            ISTJ: { title: '物流師 / 檢查員', desc: '務實、可靠、重視規則與秩序。做事有條不紊，是組織中最穩定的基石。' },
            ISFJ: { title: '守衛者 / 保護者', desc: '溫柔、盡責、默默守護他人。極富耐心與責任感，樂於為他人付出。' },
            ESTJ: { title: '總經理 / 管家', desc: '組織力強、重效率、實事求是。重視秩序與傳統，擅長管理專案與協調人員。' },
            ESFJ: { title: '執政官 / 東道主', desc: '熱心、愛幫助人、重視和諧。喜歡社交，並渴望為周圍的人帶來歡笑與溫暖。' },
            ISTP: { title: '鑑賞家 / 手藝人', desc: '冷靜、動手能力強、靈活隨性。善於觀察，喜歡拆解問題並親自動手解決。' },
            ISFP: { title: '探險家 / 藝術家', desc: '溫柔、敏感、享受當下美感。愛好自由，傾向以低調且有創意的方式生活。' },
            ESTP: { title: '企業家 / 實踐者', desc: '活潑、冒險心強、專注解決當前問題。行事迅速，能立刻適應多變的環境。' },
            ESFP: { title: '表演者 / 娛樂家', desc: '熱情洋溢、即興發揮、喜愛帶給他人歡樂。熱愛成為焦點，對生活充滿動力。' }
        };

        const profile = profiles[mbti] || { title: '未知類型', desc: '無法取得對應的 MBTI 描述。' };

        this.isTyping = true;

        this.print(bold(yellow('==================================================')) + '\r\n');
        this.print(bold(cyan('              MBTI 職業性格測試結果')) + '\r\n');
        this.print(bold(yellow('==================================================')) + '\r\n');
        this.print(`  您的 MBTI 類型是：${bold(magenta(mbti))} (${bold(white(profile.title))})\r\n\r\n`);
        this.print(`  ${bold(white('[性格解析]'))}\r\n`);
        this.print(`  ${profile.desc}\r\n`);
        this.print(bold(yellow('==================================================')) + '\r\n\r\n');

        this.printThen('', () => {
            this.isTyping = false;
            this.close();
        });
    }

    static get commandName() { return 'mbti'; }
    static get help() { return 'MBTI personality test (interactive)'; }
    static get menu() { return 'MBTI Personality Test'; }
}
