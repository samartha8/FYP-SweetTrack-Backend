/**
 * Metabolic Audit Service: Analyzes daily nutrition and generates clinical "Good vs Bad" reports.
 */
export const generateDailyAudit = (meals = [], userRisk = null) => {
    if (meals.length === 0) {
        return {
            status: 'empty',
            message: "No meals logged today. Consistency is key for metabolic health."
        };
    }

    const totals = meals.reduce((acc, meal) => ({
        calories: acc.calories + (meal.nutritionalInfo.calories || 0),
        carbs: acc.carbs + (meal.nutritionalInfo.carbs || 0),
        sugar: acc.sugar + (meal.nutritionalInfo.sugar || 0),
        fiber: acc.fiber + (meal.nutritionalInfo.fiber || 0),
        protein: acc.protein + (meal.nutritionalInfo.protein || 0),
    }), { calories: 0, carbs: 0, sugar: 0, fiber: 0, protein: 0 });

    const wins = [];
    const risks = [];
    const tips = [];

    // 🏆 Rule: Fiber Buffer
    if (totals.fiber >= 25) {
        wins.push({
            title: "Fiber Mastery",
            detail: `You hit ${Math.round(totals.fiber)}g of fiber. This creates a powerful glucose buffer.`,
            type: 'green'
        });
    } else if (totals.fiber > totals.sugar) {
        wins.push({
            title: "Positive Fiber Ratio",
            detail: "Your fiber intake is higher than your sugar intake - great for insulin stability.",
            type: 'green'
        });
    } else {
        risks.push({
            title: "Low Fiber Buffer",
            detail: "Your meals were low in fiber today, which makes sugar spikes more likely.",
            type: 'amber'
        });
        tips.push("Try adding greens or sprouted seeds to your lunch tomorrow.");
    }

    // 🚩 Rule: Sugar Hazard
    const isHighRisk = userRisk?.riskLevel === 'High Risk';
    const sugarLimit = isHighRisk ? 25 : 40;
    const calorieLimit = isHighRisk ? 2000 : 2500;

    if (totals.sugar > sugarLimit) {
        risks.push({
            title: "Sugar Surge Detected",
            detail: `${Math.round(totals.sugar)}g of sugar today exceeds your recommended metabolic limit.`,
            type: 'red'
        });
        tips.push("Identify the high-sugar items from today and swap them for nature's sweets like berries.");
    } else if (totals.sugar < 15) {
        wins.push({
            title: "Excellent Sugar Control",
            detail: "Near-zero added sugar today! Your pancreas is in recovery mode.",
            type: 'green'
        });
    }

    // 🥩 Rule: Protein Stability
    if (totals.calories > calorieLimit) {
        risks.push({
            title: "Excess Energy Load",
            detail: `${Math.round(totals.calories)} kcal logged today with a high metabolic load. Activity or portion control is needed to offset this.`,
            type: totals.calories > calorieLimit + 500 ? 'red' : 'amber'
        });
        tips.push("Keep tomorrow's portions structured: protein first, vegetables second, and reduce repeated snack cycles.");
    }

    if (meals.length >= 5) {
        risks.push({
            title: "Frequent Eating Pattern",
            detail: `${meals.length} eating events were logged today. Constant intake can keep insulin elevated for longer periods.`,
            type: 'amber'
        });
        tips.push("Create a clear meal window tomorrow and avoid grazing between meals.");
    }

    if (totals.protein < 40) {
        risks.push({
            title: "Protein Deficit",
            detail: "Low protein can lead to increased hunger and unstable energy levels.",
            type: 'amber'
        });
    }

    // 💡 Overall Strategy
    let summary = "Balanced day: You are maintaining steady metabolic progress.";
    if (risks.some(r => r.type === 'red')) {
        summary = "Risk Alert: High metabolic load detected. Focus on cleanup tomorrow.";
    } else if (risks.length > 0) {
        summary = "Action Required: Some habits increased metabolic load today. Small corrections tomorrow can bring you back into balance.";
    } else if (wins.length >= 2) {
        summary = "Synergy Peak: Your habits are actively reversing metabolic decline today!";
    }

    return {
        status: 'success',
        totals: {
            calories: Math.round(totals.calories),
            carbs: Math.round(totals.carbs * 10) / 10,
            sugar: Math.round(totals.sugar * 10) / 10,
            fiber: Math.round(totals.fiber * 10) / 10,
            protein: Math.round(totals.protein * 10) / 10,
        },
        report: {
            summary,
            wins,
            risks,
            tips: tips.length > 0 ? tips : ["Stay consistent! You are doing great."]
        }
    };
};
