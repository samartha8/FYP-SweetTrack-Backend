import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const NUTRITION_PATH = path.join(__dirname, '../../ml_models/nutrition_lookup.json');
let nutritionDb = {};

// Load local database
try {
    const rawData = fs.readFileSync(NUTRITION_PATH, 'utf8');
    nutritionDb = JSON.parse(rawData);
} catch (err) {
    console.error('❌ Failed to load nutrition_lookup.json in textService:', err.message);
}

const NUMBER_WORDS = {
    a: 1,
    an: 1,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10
};

const getQuantity = (segment) => {
    const wordsArray = segment.split(/\s+/);
    for (const w of wordsArray) {
        if (!isNaN(parseInt(w))) return parseInt(w);
        if (NUMBER_WORDS[w]) return NUMBER_WORDS[w];
    }
    return 1;
};

const getPortionScale = (segment) => {
    if (segment.includes('big') || segment.includes('large') || segment.includes('heavy')) {
        return { scalar: 1.4, sizeLabel: 'Big' };
    }
    if (segment.includes('small') || segment.includes('tiny') || segment.includes('little')) {
        return { scalar: 0.7, sizeLabel: 'Small' };
    }
    return { scalar: 1.0, sizeLabel: 'Standard' };
};

const singularize = (word) => (
    word.endsWith('s') && word.length > 3 ? word.slice(0, -1) : word
);

const findBestFoodKey = (segment, keys) => {
    const words = segment
        .split(/\s+/)
        .map(w => singularize(w.replace(/[^a-z0-9]/g, '')))
        .filter(w => w.length > 1);

    let best = null;
    let bestScore = 0;

    for (const key of keys) {
        const searchableKey = key.replace(/_/g, ' ');
        const keyParts = searchableKey.split(/\s+/);
        const base = keyParts[0];
        let score = 0;

        if (segment.includes(searchableKey)) {
            score = 1000 + searchableKey.length;
        } else if (words.includes(base)) {
            score = 500 + base.length;
            if (key.includes('yellow') || key.includes('round') || key.includes('white')) score += 5;
        } else if (words.some(w => keyParts.includes(w))) {
            score = 150;
        }

        if (score > bestScore) {
            best = key;
            bestScore = score;
        }
    }

    return best;
};

/**
 * Local NLP Service: Maps user descriptions to nutritionDb keys using keyword matching.
 */
export const analyzeTextLocally = (text) => {
    if (!text) return null;

    const lowerText = text.toLowerCase();
    const foundItems = [];

    // 1. Split multi-food descriptions into item-like segments.
    // Example: "2 slices of pizza and one banana" -> ["2 slices of pizza", "one banana"]
    const segments = lowerText
        .split(/\s*(?:,|\+|&|\band\b|\bwith\b)\s*/i)
        .map(s => s.trim())
        .filter(Boolean);

    // 2. Keyword Search
    // We sort keys by length (descending) so exact longer names match before generic names.
    const keys = Object.keys(nutritionDb).sort((a, b) => b.length - a.length);

    for (const segment of segments) {
        const key = findBestFoodKey(segment, keys);
        if (!key) continue;

        const searchableKey = key.replace(/_/g, ' ');
        const nutrition = nutritionDb[key];
        const { scalar, sizeLabel } = getPortionScale(segment);
        const quantity = getQuantity(segment);

        if (foundItems.some(item => item.class === key)) {
            const existing = foundItems.find(item => item.class === key);
            existing.count += quantity;
            continue;
        }

        foundItems.push({
            name: searchableKey.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
            class: key,
            category: nutrition.category,
            confidence: 1.0, // Manual entries are considered 100% intentional
            portionSize: sizeLabel,
            scalar: scalar,
            count: quantity,
            perItemNutrition: {
                calories: parseFloat(((nutrition.calories || 0) * scalar).toFixed(1)),
                protein: parseFloat(((nutrition.protein_g || 0) * scalar).toFixed(1)),
                fat: parseFloat(((nutrition.fat_g || 0) * scalar).toFixed(1)),
                carbs: parseFloat(((nutrition.carbs_g || 0) * scalar).toFixed(1)),
                fiber: parseFloat(((nutrition.fiber_g || 0) * scalar).toFixed(1)),
                sugar: parseFloat(((nutrition.sugar_g || 0) * scalar).toFixed(1)),
                sodium: parseFloat(((nutrition.sodium_mg || 0) * scalar).toFixed(1))
            }
        });
    }

    if (foundItems.length === 0) {
        const suggestions = [];
        const words = lowerText.split(/\s+/).filter(w => w.length > 2);
        
        if (words.length > 0) {
            for (const key of keys) {
                const searchableKey = key.replace(/_/g, ' ');
                // Basic plural matching: if word ends in 's', check singular form
                if (words.some(w => searchableKey.includes(w) || (w.endsWith('s') && w.length > 3 && searchableKey.includes(w.slice(0, -1))))) {
                    suggestions.push(searchableKey);
                }
                if (suggestions.length >= 3) break;
            }
        }
        
        return { error: true, suggestions };
    }

    // 3. Aggregate
    const aggregated = foundItems.reduce((acc, item) => ({
        calories: acc.calories + (item.perItemNutrition.calories * item.count),
        protein: acc.protein + (item.perItemNutrition.protein * item.count),
        fat: acc.fat + (item.perItemNutrition.fat * item.count),
        carbs: acc.carbs + (item.perItemNutrition.carbs * item.count),
        fiber: acc.fiber + (item.perItemNutrition.fiber * item.count),
        sugar: acc.sugar + (item.perItemNutrition.sugar * item.count),
        sodium: acc.sodium + (item.perItemNutrition.sodium * item.count)
    }), { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0, sugar: 0, sodium: 0 });

    const exampleFood = foundItems[0]?.name || 'item';
    const nameLower = exampleFood.toLowerCase();
    const overallSizeLabel = foundItems.find(item => item.portionSize !== 'Standard')?.portionSize || 'Standard';
    let servingExample = "1 whole item";
    
    if (nameLower.includes('pizza') || nameLower.includes('pie') || nameLower.includes('cake')) {
        servingExample = "1 slice or piece";
    } else if (nameLower.includes('juice') || nameLower.includes('milk') || nameLower.includes('coffee') || nameLower.includes('drink')) {
        servingExample = "1 standard glass or cup";
    } else if (nameLower.includes('momo') || nameLower.includes('dumpling')) {
        servingExample = "1 single piece (Not a full plate! A plate usually has 10 pieces.)";
    } else if (nameLower.includes('rice') || nameLower.includes('soup') || nameLower.includes('salad') || nameLower.includes('curry')) {
        servingExample = "1 standard bowl or portion";
    }

    return {
        foodItems: foundItems,
        nutritionalInfo: {
            ...aggregated,
            calories: Math.round(aggregated.calories)
        },
        servingSize: overallSizeLabel === 'Standard' ? `1 Standard Serving (${servingExample})` : overallSizeLabel,
        healthTips: [
            `Note: Values represent 1 standard serving of ${exampleFood} (typically ${servingExample}). If you ate a different amount, please specify the quantity (e.g. '3 portions of ${exampleFood}').`
        ],
        isManual: true
    };
};
