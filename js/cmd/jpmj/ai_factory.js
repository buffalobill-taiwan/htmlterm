import { BeginnerAI } from './ai_beginner.js';
import { NormalAI } from './ai_normal.js';
import { ExpertAI } from './ai_expert.js';
import { KokushiAI } from './ai_kokushi.js';
import { TanyaoAI } from './ai_tanyao.js';
import { MenzenAI } from './ai_menzen.js';

export const AI_TYPES = [
    { id: 'beginner', label: '初學者' },
    { id: 'normal', label: '一般人' },
    { id: 'expert', label: '高手' },
    { id: 'kokushi', label: '国士命' },
    { id: 'tanyao', label: '断么廚' },
    { id: 'menzen', label: '門清俠' },
];

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
