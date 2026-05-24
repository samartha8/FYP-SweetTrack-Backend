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

/**
 * Local NLP Service: Maps user descriptions to nutritionDb keys using keyword matching.
 */
export const analyzeTextLocally = (text) => {
    if (!text) return null;

    const lowerText = text.toLowerCase();
    const foundItems = [];
    
    // 1. Portion Detection
    let scalar = 1.0;
    let sizeLabel = 'Standard';

    if (lowerText.includes('big') || lowerText.includes('large') || lowerText.includes('heavy')) {
        scalar = 1.4;
        sizeLabel = 'Big';
    } else if (lowerText.includes('small') || lowerText.includes('tiny') || lowerText.includes('little')) {
        scalar = 0.7;
        sizeLabel = 'Small';
    }

    // 1.5. Quantity Detection
    let quantity = 1;
    const numberWords = { 'a': 1, 'an': 1, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10 };
    const wordsArray = lowerText.split(/\s+/);
    for (const w of wordsArray) {
        if (!isNaN(parseInt(w))) {
            quantity = parseInt(w);
            break;
        } else if (numberWords[w]) {
            quantity = numberWords[w];
            break;
        }
    }

    // 2. Keyword Search
    // We sort keys by length (descending) so "apple_ligol" matches before "apple"
    const keys = Object.keys(nutritionDb).sort((a, b) => b.length - a.length);

    for (const key of keys) {
        // Replace underscores with spaces for natural matching (e.g., "apple fuji")
        const searchableKey = key.replace(/_/g, ' ');
        
        if (lowerText.includes(searchableKey)) {
            const nutrition = nutritionDb[key];
            
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

            // Prevent matching the same substring twice
            // (e.g. if we matched "apple ligol", don't match "apple" separately)
            break; 
        }
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
        servingSize: sizeLabel === 'Standard' ? `1 Standard Serving (${servingExample})` : sizeLabel,
        healthTips: [
            `Note: Values represent 1 standard serving of ${exampleFood} (typically ${servingExample}). If you ate a different amount, please specify the quantity (e.g. '3 portions of ${exampleFood}').`
        ],
        isManual: true
    };
};
