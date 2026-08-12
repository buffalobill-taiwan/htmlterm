import { CmdBase } from './CmdBase.js';

const TEXT = '先生不知何許人也，亦不詳其姓字。宅邊有五柳樹，因以為號焉。閑靜少言，不慕榮利。好讀書，不求甚解，每有會意，便欣然忘食。性嗜酒，家貧，不能常得。親舊知其如此，或置酒而招之。造飲輒盡，期在必醉，既醉而退，曾不吝情去留。環堵蕭然，不蔽風日；短褐穿結，簞瓢屢空ㄧ晏如也。常著文章自娛，頗示己志。忘懷得失，以此自終。';

const PRAISE = '贊曰：黔婁之妻有言：「不戚戚於貧賤，不汲汲於富貴。」極其言，茲若人之儔乎？酣觴賦詩，以樂其志。無懷氏之民歟！葛天氏之民歟！';

export class FiveWillow extends CmdBase {
    execute(args) {
        const body = TEXT + PRAISE + '\n';
        this.print(args.includes('--big') ? '\x1B[500m' + body + '\x1B[501m' : body);
    }

    static get commandName() { return '5willow'; }
    static get help() { return 'Print 五柳先生傳'; }
    static get menu() { return '五柳先生傳'; }
    static get usage() { return '5willow [--big]'; }
}
