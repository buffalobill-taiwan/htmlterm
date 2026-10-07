import { BeginnerAI } from './ai_beginner.js';
import { NormalAI } from './ai_normal.js';
import { ExpertAI } from './ai_expert.js';
import { KokushiAI } from './ai_kokushi.js';
import { TanyaoAI } from './ai_tanyao.js';
import { MenzenAI } from './ai_menzen.js';


export function createAI(difficulty) {
    switch (difficulty) {
        case 'expert': return new ExpertAI();
        case 'beginner': return new BeginnerAI();
        case 'kokushi': return new KokushiAI();
        case 'tanyao': return new TanyaoAI();
        case 'menzen': return new MenzenAI();
        case 'normal':
        default: return new NormalAI();
    }
}
