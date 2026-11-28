import type { FilterRecipe } from './schema';
import { pillClassFor } from './grouped-select';
import { FilterIcon } from './icons';

export interface RecipesGridProps {
  recipes: readonly FilterRecipe[];
  onPick: (recipe: FilterRecipe) => void;
  onClose?: () => void;
}

export function RecipesGrid({ recipes, onPick, onClose }: RecipesGridProps) {
  if (recipes.length === 0) {
    return null;
  }
  return (
    <div className="fr-recipes">
      <div className="fr-recipes-head">
        <h4 className="fr-recipes-title">Start from a recipe</h4>
        {onClose && (
          <button
            className="fr-icon-btn"
            type="button"
            aria-label="Close recipes"
            onClick={onClose}
          >
            <FilterIcon name="close" size={14} />
          </button>
        )}
      </div>
      <div className="fr-recipes-grid">
        {recipes.map((recipe) => (
          <button
            key={recipe.id}
            className="fr-recipe-card"
            type="button"
            onClick={() => onPick(recipe)}
          >
            <div className="fr-recipe-head">
              <span className="fr-recipe-name">{recipe.title}</span>
              <span className={pillClassFor(recipe)}>{recipe.badge}</span>
            </div>
            <p className="fr-recipe-desc">{recipe.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
