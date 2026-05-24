import argparse
import json
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_CLASSES_PATH = BASE_DIR / "class_names.json"
DEFAULT_NUTRITION_PATH = BASE_DIR / "nutrition_lookup.json"
DEFAULT_OUTPUT_DIR = BASE_DIR / "catalog"

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}

CATEGORY_RULES = [
    ("Fruit", [
        "apple", "apricot", "avocado", "banana", "grape", "grapefruit", "kiwi",
        "lemon", "lime", "mango", "melon", "nectarine", "orange", "pear",
        "plum", "pomegranate", "pomelo", "strawberry", "tangerine", "watermelon",
    ]),
    ("Vegetable", [
        "beet", "cabbage", "carrot", "corn", "cucumber", "daikon", "garlic",
        "onion", "pepper", "potato", "pumpkin", "raddish", "tomato", "zucchini",
    ]),
    ("Dessert", [
        "baklava", "beignets", "cake", "cheesecake", "chocolate", "churros",
        "creme_brulee", "cup_cakes", "donuts", "frozen_yogurt", "ice_cream",
        "macarons", "panna_cotta", "pudding", "red_velvet", "shortcake",
        "tiramisu", "waffles",
    ]),
    ("Soup", ["bisque", "chowder", "soup", "pho", "ramen"]),
    ("Salad", ["salad", "guacamole", "hummus"]),
    ("Meat", [
        "beef", "chicken", "duck", "filet", "hamburger", "hot_dog", "pork",
        "prime_rib", "pulled_pork", "ribs", "steak",
    ]),
    ("Seafood", [
        "calamari", "ceviche", "crab", "fish", "lobster", "mussels", "oysters",
        "salmon", "sashimi", "scallops", "shrimp", "sushi", "tuna",
    ]),
    ("Rice/Noodles", ["bibimbap", "fried_rice", "gnocchi", "pad_thai", "paella", "risotto"]),
    ("Fast Food", ["fries", "nachos", "onion_rings", "pizza", "sandwich", "tacos"]),
    ("Breakfast", ["breakfast", "eggs", "french_toast", "omelette", "pancakes"]),
    ("Snack/Appetizer", [
        "bruschetta", "dumplings", "edamame", "falafel", "gyoza", "samosa",
        "spring_rolls", "takoyaki",
    ]),
    ("Pasta", ["lasagna", "macaroni", "ravioli", "spaghetti"]),
]


def load_json(path):
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def display_name(food_id):
    return food_id.replace("_", " ").title()


def infer_category(food_id):
    normalized = food_id.lower()
    for category, keywords in CATEGORY_RULES:
        if any(keyword in normalized for keyword in keywords):
            return category
    return "Other"


def find_dataset_image(dataset_dir, food_id):
    if not dataset_dir:
        return None

    class_dir = dataset_dir / food_id
    if not class_dir.exists():
        return None

    for image_path in sorted(class_dir.iterdir()):
        if image_path.suffix.lower() in IMAGE_EXTENSIONS:
            return image_path.resolve()
    return None


def build_catalog(classes, nutrition_db, dataset_dir=None):
    catalog = []
    for food_id in classes:
        nutrition = nutrition_db.get(food_id, {})
        image_path = find_dataset_image(dataset_dir, food_id)
        catalog.append({
            "id": food_id,
            "name": display_name(food_id),
            "category": infer_category(food_id),
            "image": image_path.as_uri() if image_path else None,
            "nutrition": {
                "calories": nutrition.get("calories", 0),
                "carbs_g": nutrition.get("carbs_g", 0),
                "protein_g": nutrition.get("protein_g", 0),
                "fat_g": nutrition.get("fat_g", 0),
                "sugar_g": nutrition.get("sugar_g", 0),
            },
        })
    return catalog


def write_json(catalog, output_dir):
    output_path = output_dir / "smart_meal_food_catalog.json"
    with output_path.open("w", encoding="utf-8") as file:
        json.dump(catalog, file, indent=2)
    return output_path


def write_html(catalog, output_dir, limit=None):
    visible_items = catalog[:limit] if limit else catalog
    category_options = sorted({item["category"] for item in catalog})
    cards = []

    for item in visible_items:
        image_html = (
            f'<img src="{item["image"]}" alt="{item["name"]}">'
            if item["image"]
            else f'<div class="placeholder">{item["name"][:1]}</div>'
        )
        cards.append(f"""
        <article class="card" data-category="{item["category"]}">
          <div class="media">{image_html}</div>
          <p class="category">[{item["category"]}]</p>
          <h2>{item["name"]}</h2>
          <p class="meta">{item["nutrition"]["calories"]} kcal | {item["nutrition"]["carbs_g"]}g carbs | {item["nutrition"]["sugar_g"]}g sugar</p>
          <p class="id">{item["id"]}</p>
        </article>
        """)

    filters = "\n".join(
        f'<option value="{category}">{category}</option>' for category in category_options
    )

    html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Smart Meal Supported Foods</title>
  <style>
    body {{
      margin: 0;
      font-family: Arial, sans-serif;
      background: #f8fafc;
      color: #111827;
    }}
    header {{
      position: sticky;
      top: 0;
      z-index: 2;
      display: flex;
      gap: 16px;
      align-items: center;
      justify-content: space-between;
      padding: 18px 24px;
      background: #ffffff;
      border-bottom: 1px solid #e5e7eb;
    }}
    h1 {{
      margin: 0;
      font-size: 22px;
    }}
    select, input {{
      height: 38px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      padding: 0 10px;
      background: #ffffff;
    }}
    .tools {{
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }}
    .grid {{
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
      gap: 18px;
      padding: 24px;
    }}
    .card {{
      min-height: 250px;
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 12px;
      box-shadow: 0 8px 20px rgba(15, 23, 42, 0.06);
    }}
    .media {{
      display: grid;
      place-items: center;
      height: 120px;
      background: #f1f5f9;
      border-radius: 6px;
      overflow: hidden;
    }}
    img {{
      width: 100%;
      height: 100%;
      object-fit: cover;
    }}
    .placeholder {{
      display: grid;
      place-items: center;
      width: 62px;
      height: 62px;
      border-radius: 50%;
      background: #16a34a;
      color: #ffffff;
      font-size: 30px;
      font-weight: 700;
    }}
    .category {{
      margin: 10px 0 2px;
      color: #2563eb;
      font-size: 12px;
      font-weight: 700;
    }}
    h2 {{
      margin: 0;
      font-size: 16px;
      line-height: 1.25;
    }}
    .meta {{
      margin: 8px 0;
      color: #4b5563;
      font-size: 12px;
      line-height: 1.35;
    }}
    .id {{
      margin: 0;
      color: #6b7280;
      font-family: Consolas, monospace;
      font-size: 11px;
    }}
    .hidden {{
      display: none;
    }}
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Smart Meal Supported Foods</h1>
      <span>{len(catalog)} Keras model classes</span>
    </div>
    <div class="tools">
      <input id="search" type="search" placeholder="Search food">
      <select id="category">
        <option value="">All categories</option>
        {filters}
      </select>
    </div>
  </header>
  <main class="grid" id="grid">
    {"".join(cards)}
  </main>
  <script>
    const search = document.querySelector("#search");
    const category = document.querySelector("#category");
    const cards = [...document.querySelectorAll(".card")];

    function applyFilters() {{
      const query = search.value.trim().toLowerCase();
      const selectedCategory = category.value;
      cards.forEach((card) => {{
        const textMatch = card.innerText.toLowerCase().includes(query);
        const categoryMatch = !selectedCategory || card.dataset.category === selectedCategory;
        card.classList.toggle("hidden", !(textMatch && categoryMatch));
      }});
    }}

    search.addEventListener("input", applyFilters);
    category.addEventListener("change", applyFilters);
  </script>
</body>
</html>
"""

    output_path = output_dir / "smart_meal_food_catalog.html"
    with output_path.open("w", encoding="utf-8") as file:
        file.write(html)
    return output_path


def main():
    parser = argparse.ArgumentParser(description="Create a Smart Meal supported-foods catalog.")
    parser.add_argument("--classes", type=Path, default=DEFAULT_CLASSES_PATH)
    parser.add_argument("--nutrition", type=Path, default=DEFAULT_NUTRITION_PATH)
    parser.add_argument("--dataset", type=Path, help="Optional dataset folder with one subfolder per class.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--limit", type=int, help="Optional number of foods to show in the HTML.")
    args = parser.parse_args()

    classes = load_json(args.classes)
    nutrition_db = load_json(args.nutrition)
    args.output.mkdir(parents=True, exist_ok=True)

    catalog = build_catalog(classes, nutrition_db, args.dataset)
    json_path = write_json(catalog, args.output)
    html_path = write_html(catalog, args.output, args.limit)

    print(f"Created JSON catalog: {json_path}")
    print(f"Created HTML catalog: {html_path}")
    print(f"Foods in Smart Meal model: {len(catalog)}")
    if not args.dataset:
        print("No dataset folder was provided, so the HTML uses placeholders instead of sample photos.")


if __name__ == "__main__":
    main()
