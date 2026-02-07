import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import './App.css'
import { baseRecipes } from './data/baseRecipes'
import type {
  AiSettings,
  ConversationTurn,
  Equipment,
  Ingredient,
  Preferences,
  Recipe,
} from './types'
import { buildShareUrl, decodeRecipeFromUrl } from './utils/share'
import { readStorage, writeStorage } from './utils/storage'
import {
  ALLERGEN_OPTIONS,
  DIETARY_OPTIONS,
  PANTRY_SUGGESTIONS,
  UNIT_OPTIONS,
  buildShoppingList,
  buildSwapSuggestions,
  formatIngredient,
  generateRecipeOptions,
  isRecipeLike,
  missingIngredients,
  normalisePantryItems,
  pantryFitPercent,
  recipeToPlainText,
  scaleIngredients,
} from './utils/recipeEngine'
import { generateRecipesWithLlm } from './utils/llm'

const STORAGE_KEYS = {
  pantry: 'recipe-creator-pantry-v2',
  preferences: 'recipe-creator-preferences-v2',
  customRecipes: 'recipe-creator-custom-recipes-v2',
  aiSettings: 'recipe-creator-ai-settings-v2',
}

const equipmentOptions: Equipment[] = ['hob', 'oven', 'air-fryer']

const defaultPreferences: Preferences = {
  servings: 4,
  maxCookTime: 45,
  cuisine: '',
  dietary: [],
  allergensToAvoid: [],
  equipment: ['hob', 'oven'],
}

const defaultAiSettings: AiSettings = {
  apiKey: '',
  model: 'gpt-4.1-mini',
  endpoint: 'https://api.openai.com/v1/chat/completions',
  creativity: 0.8,
  rememberKey: false,
}

const defaultGoals = [
  'Fast, flavour-packed weeknight meals with minimal washing up.',
  'High-protein comfort bowls using pantry-heavy ingredients.',
  'Impressive dinner-party mains with one easy side.',
  'Budget-friendly, family-style meals with leftovers.',
]

interface CookModeState {
  recipeId: string
  stepIndex: number
  timerEndsAt?: number
}

interface CompareSelection {
  left?: string
  right?: string
}

const getId = (prefix: string): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const toggleListValue = <T extends string>(list: T[], value: T): T[] =>
  list.includes(value) ? list.filter((item) => item !== value) : [...list, value]

const ensureUniqueRecipes = (recipes: Recipe[]): Recipe[] => {
  const map = new Map<string, Recipe>()
  recipes.forEach((recipe) => {
    map.set(recipe.id, recipe)
  })
  return Array.from(map.values())
}

const normalizeRecipeForStorage = (recipe: Recipe): Recipe => ({
  ...recipe,
  id: recipe.id || getId('recipe'),
  title: recipe.title.trim() || 'Untitled recipe',
  description: recipe.description.trim() || 'No description.',
  cuisine: recipe.cuisine.trim() || 'Fusion',
  cookTimeMinutes: Math.max(5, Math.round(recipe.cookTimeMinutes || 30)),
  servings: Math.max(1, Math.round(recipe.servings || 1)),
  ingredients:
    recipe.ingredients.length > 0
      ? recipe.ingredients
      : [{ name: 'water', quantity: 500, unit: 'ml', optional: false }],
  steps:
    recipe.steps.length > 0
      ? recipe.steps
      : [
          { text: 'Prepare ingredients.' },
          { text: 'Cook and season to taste.' },
        ],
})

function App() {
  const [pantryInput, setPantryInput] = useState('')
  const [pantryItems, setPantryItems] = useState<string[]>(() =>
    readStorage<string[]>(STORAGE_KEYS.pantry, []),
  )
  const [preferences, setPreferences] = useState<Preferences>(() =>
    readStorage<Preferences>(STORAGE_KEYS.preferences, defaultPreferences),
  )

  const initialAiSettings = readStorage<AiSettings>(STORAGE_KEYS.aiSettings, defaultAiSettings)
  const [aiSettings, setAiSettings] = useState<AiSettings>(() => ({
    ...defaultAiSettings,
    ...initialAiSettings,
    apiKey: initialAiSettings.rememberKey ? initialAiSettings.apiKey : '',
  }))

  const [customRecipes, setCustomRecipes] = useState<Recipe[]>(() =>
    readStorage<Recipe[]>(STORAGE_KEYS.customRecipes, []),
  )
  const [generatedRecipes, setGeneratedRecipes] = useState<Recipe[]>([])
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null)
  const [editingRecipeId, setEditingRecipeId] = useState<string | null>(null)
  const [goalPrompt, setGoalPrompt] = useState(defaultGoals[0])
  const [followUpPrompt, setFollowUpPrompt] = useState('')
  const [recipeCount, setRecipeCount] = useState(4)
  const [isGenerating, setIsGenerating] = useState(false)
  const [conversation, setConversation] = useState<ConversationTurn[]>([])
  const [statusMessage, setStatusMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [cookMode, setCookMode] = useState<CookModeState | null>(null)
  const [clockTick, setClockTick] = useState(Date.now())
  const [servingOverrides, setServingOverrides] = useState<Record<string, number>>({})
  const [compareSelection, setCompareSelection] = useState<CompareSelection>({})

  useEffect(() => {
    writeStorage(STORAGE_KEYS.pantry, pantryItems)
  }, [pantryItems])

  useEffect(() => {
    writeStorage(STORAGE_KEYS.preferences, preferences)
  }, [preferences])

  useEffect(() => {
    writeStorage(STORAGE_KEYS.customRecipes, customRecipes.map(normalizeRecipeForStorage))
  }, [customRecipes])

  useEffect(() => {
    const persisted: AiSettings = {
      ...aiSettings,
      apiKey: aiSettings.rememberKey ? aiSettings.apiKey : '',
    }
    writeStorage(STORAGE_KEYS.aiSettings, persisted)
  }, [aiSettings])

  useEffect(() => {
    if (!cookMode?.timerEndsAt) {
      return
    }

    const interval = window.setInterval(() => {
      setClockTick(Date.now())
    }, 1000)

    return () => window.clearInterval(interval)
  }, [cookMode?.timerEndsAt])

  useEffect(() => {
    if (!cookMode?.timerEndsAt) {
      return
    }

    if (cookMode.timerEndsAt <= clockTick) {
      setCookMode((current) => (current ? { ...current, timerEndsAt: undefined } : current))
      setStatusMessage('Step timer complete. Move to the next instruction.')
    }
  }, [clockTick, cookMode])

  useEffect(() => {
    const encodedRecipe = new URLSearchParams(window.location.search).get('recipe')
    if (!encodedRecipe) {
      return
    }

    const decoded = decodeRecipeFromUrl(encodedRecipe)
    if (decoded && isRecipeLike(decoded)) {
      const normalized = normalizeRecipeForStorage({ ...decoded, source: 'shared', id: getId('shared') })
      setGeneratedRecipes((current) => ensureUniqueRecipes([normalized, ...current]))
      setSelectedRecipeId(normalized.id)
      setStatusMessage('Loaded shared recipe from URL.')
    }
  }, [])

  const selectedRecipe = useMemo(
    () => generatedRecipes.find((recipe) => recipe.id === selectedRecipeId) ?? null,
    [generatedRecipes, selectedRecipeId],
  )

  const compareLeft = useMemo(
    () => generatedRecipes.find((recipe) => recipe.id === compareSelection.left) ?? null,
    [generatedRecipes, compareSelection.left],
  )

  const compareRight = useMemo(
    () => generatedRecipes.find((recipe) => recipe.id === compareSelection.right) ?? null,
    [generatedRecipes, compareSelection.right],
  )

  const shoppingList = useMemo(
    () => buildShoppingList(generatedRecipes, pantryItems),
    [generatedRecipes, pantryItems],
  )

  const activeCookRecipe = useMemo(
    () => generatedRecipes.find((recipe) => recipe.id === cookMode?.recipeId) ?? null,
    [generatedRecipes, cookMode?.recipeId],
  )

  const activeCookStep =
    activeCookRecipe && cookMode ? activeCookRecipe.steps[cookMode.stepIndex] ?? null : null

  const timerSecondsRemaining = cookMode?.timerEndsAt
    ? Math.max(0, Math.ceil((cookMode.timerEndsAt - clockTick) / 1000))
    : 0

  const addPantryItem = (rawItem: string) => {
    const nextItems = normalisePantryItems([...pantryItems, rawItem])
    setPantryItems(nextItems)
    setPantryInput('')
  }

  const handlePantrySubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!pantryInput.trim()) {
      return
    }
    addPantryItem(pantryInput)
  }

  const recordConversation = (role: ConversationTurn['role'], text: string) => {
    setConversation((current) => [
      { role, text, createdAt: new Date().toISOString() },
      ...current,
    ])
  }

  const applyGeneratedRecipes = (nextRecipes: Recipe[], summary: string) => {
    setGeneratedRecipes(nextRecipes)
    setSelectedRecipeId(nextRecipes[0]?.id ?? null)
    setStatusMessage(summary)
    setErrorMessage('')
  }

  const generateOfflineFallback = () => {
    const options = generateRecipeOptions([...baseRecipes, ...customRecipes], pantryItems, preferences)
    applyGeneratedRecipes(options, 'Generated from offline library. Add an API key for dynamic AI recipes.')
    recordConversation('assistant', 'Used offline fallback generation because no API key was provided.')
  }

  const runGeneration = async (goal: string) => {
    if (!aiSettings.apiKey.trim()) {
      generateOfflineFallback()
      return
    }

    const outcome = await generateRecipesWithLlm({
      pantryItems,
      preferences,
      goal,
      recipeCount,
      settings: aiSettings,
    })

    applyGeneratedRecipes(outcome.recipes, outcome.assistantSummary)
    recordConversation('assistant', outcome.assistantSummary)
  }

  const handleGenerateRecipes = async () => {
    setIsGenerating(true)
    setErrorMessage('')
    recordConversation('user', goalPrompt)

    try {
      await runGeneration(goalPrompt)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown generation error.'
      setErrorMessage(message)
    } finally {
      setIsGenerating(false)
    }
  }

  const handleRefineRecipe = async () => {
    if (!selectedRecipe || !followUpPrompt.trim()) {
      setErrorMessage('Select a recipe and provide a follow-up refinement request.')
      return
    }

    if (!aiSettings.apiKey.trim()) {
      setErrorMessage('Add an API key to run recipe refinements.')
      return
    }

    setIsGenerating(true)
    setErrorMessage('')
    recordConversation('user', `Refine ${selectedRecipe.title}: ${followUpPrompt}`)

    try {
      const outcome = await generateRecipesWithLlm({
        pantryItems,
        preferences,
        goal: `Refine recipe: ${selectedRecipe.title}`,
        recipeCount: 2,
        settings: aiSettings,
        refinementContext: {
          recipe: selectedRecipe,
          instruction: followUpPrompt,
        },
      })

      const replacement = outcome.recipes
      const kept = generatedRecipes.filter((recipe) => recipe.id !== selectedRecipe.id)
      const merged = ensureUniqueRecipes([...replacement, ...kept]).slice(0, 8)
      applyGeneratedRecipes(merged, outcome.assistantSummary)
      setFollowUpPrompt('')
      recordConversation('assistant', outcome.assistantSummary)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown refinement error.'
      setErrorMessage(message)
    } finally {
      setIsGenerating(false)
    }
  }

  const updateRecipe = (recipeId: string, updater: (recipe: Recipe) => Recipe) => {
    setGeneratedRecipes((current) =>
      current.map((recipe) => (recipe.id === recipeId ? normalizeRecipeForStorage(updater(recipe)) : recipe)),
    )
  }

  const duplicateIntoCookbook = (recipe: Recipe) => {
    const clone = normalizeRecipeForStorage({
      ...recipe,
      id: getId('custom'),
      source: 'custom',
    })

    setCustomRecipes((current) => [clone, ...current])
    setStatusMessage(`Saved ${recipe.title} to your cookbook.`)
  }

  const copyText = async (text: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setStatusMessage(successMessage)
    } catch {
      setErrorMessage('Copy failed. Please copy manually.')
    }
  }

  const copyRecipe = async (recipe: Recipe) => {
    const targetServings = servingOverrides[recipe.id] ?? preferences.servings
    const scaled = scaleIngredients(recipe.ingredients, recipe.servings, targetServings)
    const missing = missingIngredients(recipe, pantryItems)
    const swaps = buildSwapSuggestions(recipe, preferences.dietary, pantryItems)

    await copyText(
      recipeToPlainText({ ...recipe, servings: targetServings }, scaled, missing, swaps),
      `Copied ${recipe.title}.`,
    )
  }

  const exportRecipe = (recipe: Recipe) => {
    const blob = new Blob([JSON.stringify(recipe, null, 2)], {
      type: 'application/json;charset=utf-8',
    })

    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${recipe.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'recipe'}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const importRecipes = (event: ChangeEvent<HTMLInputElement>) => {
    const inputFile = event.target.files?.[0]
    if (!inputFile) {
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result))
        const list = (Array.isArray(parsed) ? parsed : [parsed])
          .filter((entry) => isRecipeLike(entry))
          .map((entry) => normalizeRecipeForStorage({ ...entry, source: 'custom', id: getId('import') }))

        if (list.length === 0) {
          setErrorMessage('No valid recipe objects found in the imported JSON.')
          return
        }

        setCustomRecipes((current) => ensureUniqueRecipes([...list, ...current]))
        setStatusMessage(`Imported ${list.length} recipe(s) into cookbook.`)
      } catch {
        setErrorMessage('Import failed: invalid JSON file.')
      } finally {
        event.target.value = ''
      }
    }

    reader.readAsText(inputFile)
  }

  const removeCookbookRecipe = (recipeId: string) => {
    setCustomRecipes((current) => current.filter((recipe) => recipe.id !== recipeId))
  }

  const loadCookbookRecipe = (recipe: Recipe) => {
    const clone = normalizeRecipeForStorage({ ...recipe, id: getId('cookbook-load') })
    setGeneratedRecipes((current) => ensureUniqueRecipes([clone, ...current]))
    setSelectedRecipeId(clone.id)
    setStatusMessage(`Loaded ${recipe.title} from cookbook.`)
  }

  const assignCompare = (slot: keyof CompareSelection, recipeId: string) => {
    setCompareSelection((current) => ({ ...current, [slot]: recipeId }))
  }

  const startCookMode = (recipeId: string) => {
    setCookMode({ recipeId, stepIndex: 0 })
  }

  const moveCookStep = (delta: number) => {
    setCookMode((current) => {
      if (!current) {
        return current
      }

      const recipe = generatedRecipes.find((item) => item.id === current.recipeId)
      if (!recipe) {
        return null
      }

      const nextIndex = Math.min(Math.max(current.stepIndex + delta, 0), recipe.steps.length - 1)
      return { ...current, stepIndex: nextIndex, timerEndsAt: undefined }
    })
  }

  const startStepTimer = () => {
    if (!activeCookStep?.timerMinutes || !cookMode) {
      return
    }

    const endTimestamp = Date.now() + activeCookStep.timerMinutes * 60_000
    setCookMode({ ...cookMode, timerEndsAt: endTimestamp })
  }

  return (
    <div className="studio">
      <header className="hero">
        <div>
          <p className="kicker">AI RECIPE STUDIO</p>
          <h1>Recipe Creator: LLM Edition</h1>
          <p>
            Dynamic, model-generated recipes tailored to your pantry and constraints. Interactive cook
            mode, smart refinements, and a local cookbook included.
          </p>
        </div>
        <div className="hero-metrics" aria-label="Live app metrics">
          <p>
            <strong>{generatedRecipes.length}</strong>
            <span>Live recipes</span>
          </p>
          <p>
            <strong>{shoppingList.length}</strong>
            <span>Shopping items</span>
          </p>
          <p>
            <strong>{customRecipes.length}</strong>
            <span>Cookbook saved</span>
          </p>
        </div>
      </header>

      {statusMessage && (
        <p className="banner status" role="status">
          {statusMessage}
        </p>
      )}
      {errorMessage && (
        <p className="banner error" role="alert">
          {errorMessage}
        </p>
      )}

      <section className="workspace">
        <aside className="panel controls">
          <h2>Generate</h2>

          <fieldset>
            <legend>LLM Engine</legend>
            <label htmlFor="api-key">API key</label>
            <input
              id="api-key"
              type="password"
              value={aiSettings.apiKey}
              onChange={(event) =>
                setAiSettings((current) => ({ ...current, apiKey: event.target.value }))
              }
              placeholder="sk-..."
            />

            <label htmlFor="model">Model</label>
            <input
              id="model"
              value={aiSettings.model}
              onChange={(event) =>
                setAiSettings((current) => ({ ...current, model: event.target.value }))
              }
            />

            <label htmlFor="endpoint">Endpoint</label>
            <input
              id="endpoint"
              value={aiSettings.endpoint}
              onChange={(event) =>
                setAiSettings((current) => ({ ...current, endpoint: event.target.value }))
              }
            />

            <label htmlFor="creativity">Creativity ({aiSettings.creativity.toFixed(1)})</label>
            <input
              id="creativity"
              type="range"
              min={0}
              max={1.2}
              step={0.1}
              value={aiSettings.creativity}
              onChange={(event) =>
                setAiSettings((current) => ({
                  ...current,
                  creativity: Number(event.target.value),
                }))
              }
            />

            <label className="inline-check">
              <input
                type="checkbox"
                checked={aiSettings.rememberKey}
                onChange={(event) =>
                  setAiSettings((current) => ({ ...current, rememberKey: event.target.checked }))
                }
              />
              Remember API key on this device
            </label>
          </fieldset>

          <fieldset>
            <legend>Pantry</legend>
            <form onSubmit={handlePantrySubmit} className="row-form">
              <label htmlFor="pantry-item">Ingredient</label>
              <input
                id="pantry-item"
                value={pantryInput}
                onChange={(event) => setPantryInput(event.target.value)}
                placeholder="e.g. cannellini beans"
              />
              <button type="submit">Add</button>
            </form>

            <div className="chips">
              {PANTRY_SUGGESTIONS.map((item) => (
                <button key={item} type="button" className="chip" onClick={() => addPantryItem(item)}>
                  + {item}
                </button>
              ))}
            </div>

            <ul className="token-list" aria-label="Pantry items">
              {pantryItems.map((item) => (
                <li key={item}>
                  <span>{item}</span>
                  <button
                    type="button"
                    className="link"
                    onClick={() =>
                      setPantryItems((current) => current.filter((entry) => entry !== item))
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </fieldset>

          <fieldset>
            <legend>Preferences</legend>
            <label htmlFor="servings">Servings</label>
            <input
              id="servings"
              type="number"
              min={1}
              max={16}
              value={preferences.servings}
              onChange={(event) =>
                setPreferences((current) => ({
                  ...current,
                  servings: Math.max(1, Number(event.target.value) || 1),
                }))
              }
            />

            <label htmlFor="cook-time">Max cook time (minutes)</label>
            <input
              id="cook-time"
              type="number"
              min={10}
              max={240}
              value={preferences.maxCookTime}
              onChange={(event) =>
                setPreferences((current) => ({
                  ...current,
                  maxCookTime: Math.max(10, Number(event.target.value) || 10),
                }))
              }
            />

            <label htmlFor="cuisine">Cuisine focus</label>
            <input
              id="cuisine"
              value={preferences.cuisine}
              onChange={(event) =>
                setPreferences((current) => ({ ...current, cuisine: event.target.value }))
              }
              placeholder="Italian, Levantine, British..."
            />

            <label htmlFor="recipe-count">Recipe count ({recipeCount})</label>
            <input
              id="recipe-count"
              type="range"
              min={3}
              max={6}
              value={recipeCount}
              onChange={(event) => setRecipeCount(Number(event.target.value))}
            />

            <div className="check-grid">
              {DIETARY_OPTIONS.map((tag) => (
                <label key={tag}>
                  <input
                    type="checkbox"
                    checked={preferences.dietary.includes(tag)}
                    onChange={() =>
                      setPreferences((current) => ({
                        ...current,
                        dietary: toggleListValue(current.dietary, tag),
                      }))
                    }
                  />
                  {tag}
                </label>
              ))}
            </div>

            <div className="check-grid">
              {ALLERGEN_OPTIONS.map((allergen) => (
                <label key={allergen}>
                  <input
                    type="checkbox"
                    checked={preferences.allergensToAvoid.includes(allergen)}
                    onChange={() =>
                      setPreferences((current) => ({
                        ...current,
                        allergensToAvoid: toggleListValue(current.allergensToAvoid, allergen),
                      }))
                    }
                  />
                  avoid {allergen}
                </label>
              ))}
            </div>

            <div className="check-grid">
              {equipmentOptions.map((equipment) => (
                <label key={equipment}>
                  <input
                    type="checkbox"
                    checked={preferences.equipment.includes(equipment)}
                    onChange={() =>
                      setPreferences((current) => ({
                        ...current,
                        equipment: toggleListValue(current.equipment, equipment),
                      }))
                    }
                  />
                  {equipment}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>Prompt Studio</legend>
            <label htmlFor="goal">Generation goal</label>
            <textarea
              id="goal"
              value={goalPrompt}
              onChange={(event) => setGoalPrompt(event.target.value)}
            />

            <div className="action-row">
              {defaultGoals.map((goal) => (
                <button key={goal} type="button" className="ghost" onClick={() => setGoalPrompt(goal)}>
                  {goal.split(' ').slice(0, 3).join(' ')}...
                </button>
              ))}
            </div>

            <button type="button" className="primary" onClick={handleGenerateRecipes} disabled={isGenerating}>
              {isGenerating ? 'Generating...' : 'Generate Astonishing Recipes'}
            </button>
          </fieldset>

          <fieldset>
            <legend>Follow-up Refinement</legend>
            <label htmlFor="follow-up">Instruction</label>
            <textarea
              id="follow-up"
              value={followUpPrompt}
              onChange={(event) => setFollowUpPrompt(event.target.value)}
              placeholder="Make it air-fryer friendly, lower dairy, more spice, under 25 min..."
            />
            <button type="button" onClick={handleRefineRecipe} disabled={isGenerating || !selectedRecipe}>
              Refine Selected Recipe
            </button>
          </fieldset>

          <fieldset>
            <legend>Import / Cookbook</legend>
            <label htmlFor="import-json" className="upload-label">
              Import JSON recipes
            </label>
            <input id="import-json" type="file" accept="application/json" onChange={importRecipes} />

            <ul className="cookbook-list">
              {customRecipes.length === 0 ? (
                <li className="empty">No cookbook recipes yet.</li>
              ) : (
                customRecipes.map((recipe) => (
                  <li key={recipe.id}>
                    <div>
                      <strong>{recipe.title}</strong>
                      <p>
                        {recipe.cuisine} • {recipe.cookTimeMinutes} min
                      </p>
                    </div>
                    <div className="action-row">
                      <button type="button" onClick={() => loadCookbookRecipe(recipe)}>
                        Load
                      </button>
                      <button type="button" className="danger" onClick={() => removeCookbookRecipe(recipe.id)}>
                        Delete
                      </button>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </fieldset>
        </aside>

        <main className="panel output">
          <section className="topline">
            <h2>Generated Recipes</h2>
            {shoppingList.length > 0 && (
              <div className="shopping-inline">
                <span>Shopping list:</span>
                <p>{shoppingList.join(', ')}</p>
              </div>
            )}
          </section>

          {generatedRecipes.length === 0 ? (
            <div className="empty-hero">
              <h3>Nothing generated yet</h3>
              <p>
                Configure pantry + preferences, then generate. With API key configured, recipes are
                dynamically created by the LLM. Without it, you still get offline fallback options.
              </p>
            </div>
          ) : (
            <div className="recipe-grid">
              {generatedRecipes.map((recipe) => {
                const targetServings = servingOverrides[recipe.id] ?? preferences.servings
                const scaledIngredients = scaleIngredients(
                  recipe.ingredients,
                  recipe.servings,
                  targetServings,
                )
                const missing = missingIngredients(recipe, pantryItems)
                const swaps = buildSwapSuggestions(recipe, preferences.dietary, pantryItems)
                const fit = pantryFitPercent(recipe, pantryItems)
                const isSelected = recipe.id === selectedRecipeId
                const isEditing = recipe.id === editingRecipeId

                return (
                  <article
                    key={recipe.id}
                    className={`recipe-card ${isSelected ? 'selected' : ''}`}
                    aria-label={recipe.title}
                  >
                    <header>
                      <h3>{recipe.title}</h3>
                      <p>{recipe.description}</p>
                      <p className="meta">
                        {recipe.cuisine} • {recipe.difficulty} • {recipe.cookTimeMinutes} min
                      </p>
                    </header>

                    <div className="meter" role="progressbar" aria-valuenow={fit} aria-valuemin={0} aria-valuemax={100}>
                      <div style={{ width: `${fit}%` }} />
                      <span>{fit}% pantry fit</span>
                    </div>

                    <div className="action-row">
                      <button type="button" onClick={() => setSelectedRecipeId(recipe.id)}>
                        {isSelected ? 'Selected' : 'Select'}
                      </button>
                      <button type="button" onClick={() => assignCompare('left', recipe.id)}>
                        Compare A
                      </button>
                      <button type="button" onClick={() => assignCompare('right', recipe.id)}>
                        Compare B
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingRecipeId(isEditing ? null : recipe.id)}
                      >
                        {isEditing ? 'Done Editing' : 'Edit In-Place'}
                      </button>
                    </div>

                    <label htmlFor={`servings-${recipe.id}`}>Scale servings ({targetServings})</label>
                    <input
                      id={`servings-${recipe.id}`}
                      type="range"
                      min={1}
                      max={16}
                      value={targetServings}
                      onChange={(event) =>
                        setServingOverrides((current) => ({
                          ...current,
                          [recipe.id]: Number(event.target.value),
                        }))
                      }
                    />

                    <section>
                      <h4>Ingredients</h4>
                      <ul>
                        {scaledIngredients.map((ingredient, index) => {
                          if (!isEditing) {
                            return <li key={`${recipe.id}-ingredient-${index}`}>{formatIngredient(ingredient)}</li>
                          }

                          return (
                            <li key={`${recipe.id}-ingredient-${index}`} className="edit-line">
                              <input
                                value={ingredient.name}
                                onChange={(event) =>
                                  updateRecipe(recipe.id, (current) => ({
                                    ...current,
                                    ingredients: current.ingredients.map((entry, entryIndex) =>
                                      entryIndex === index
                                        ? { ...entry, name: event.target.value }
                                        : entry,
                                    ),
                                  }))
                                }
                              />
                              <input
                                type="number"
                                step={0.1}
                                value={ingredient.quantity}
                                onChange={(event) =>
                                  updateRecipe(recipe.id, (current) => ({
                                    ...current,
                                    ingredients: current.ingredients.map((entry, entryIndex) =>
                                      entryIndex === index
                                        ? {
                                            ...entry,
                                            quantity: Number(event.target.value) || 0,
                                          }
                                        : entry,
                                    ),
                                  }))
                                }
                              />
                              <select
                                value={ingredient.unit}
                                onChange={(event) =>
                                  updateRecipe(recipe.id, (current) => ({
                                    ...current,
                                    ingredients: current.ingredients.map((entry, entryIndex) =>
                                      entryIndex === index
                                        ? {
                                            ...entry,
                                            unit: event.target.value as Ingredient['unit'],
                                          }
                                        : entry,
                                    ),
                                  }))
                                }
                              >
                                {UNIT_OPTIONS.map((unit) => (
                                  <option key={unit} value={unit}>
                                    {unit}
                                  </option>
                                ))}
                              </select>
                            </li>
                          )
                        })}
                      </ul>

                      {isEditing && (
                        <button
                          type="button"
                          className="ghost"
                          onClick={() =>
                            updateRecipe(recipe.id, (current) => ({
                              ...current,
                              ingredients: [
                                ...current.ingredients,
                                { name: 'new ingredient', quantity: 50, unit: 'g' },
                              ],
                            }))
                          }
                        >
                          Add ingredient
                        </button>
                      )}
                    </section>

                    <section>
                      <h4>Method</h4>
                      <ol>
                        {recipe.steps.map((step, index) => {
                          const suffix = [
                            step.timerMinutes ? `${step.timerMinutes} min` : '',
                            step.temperatureC ? `${step.temperatureC}C` : '',
                            step.gasMark ? `Gas ${step.gasMark}` : '',
                          ]
                            .filter(Boolean)
                            .join(' • ')

                          if (!isEditing) {
                            return (
                              <li key={`${recipe.id}-step-${index}`}>
                                {step.text}
                                {suffix ? ` (${suffix})` : ''}
                              </li>
                            )
                          }

                          return (
                            <li key={`${recipe.id}-step-${index}`} className="edit-line">
                              <textarea
                                value={step.text}
                                onChange={(event) =>
                                  updateRecipe(recipe.id, (current) => ({
                                    ...current,
                                    steps: current.steps.map((entry, entryIndex) =>
                                      entryIndex === index ? { ...entry, text: event.target.value } : entry,
                                    ),
                                  }))
                                }
                              />
                              <input
                                type="number"
                                min={0}
                                placeholder="Timer"
                                value={step.timerMinutes ?? ''}
                                onChange={(event) =>
                                  updateRecipe(recipe.id, (current) => ({
                                    ...current,
                                    steps: current.steps.map((entry, entryIndex) =>
                                      entryIndex === index
                                        ? {
                                            ...entry,
                                            timerMinutes:
                                              Number(event.target.value) > 0
                                                ? Number(event.target.value)
                                                : undefined,
                                          }
                                        : entry,
                                    ),
                                  }))
                                }
                              />
                            </li>
                          )
                        })}
                      </ol>

                      {isEditing && (
                        <button
                          type="button"
                          className="ghost"
                          onClick={() =>
                            updateRecipe(recipe.id, (current) => ({
                              ...current,
                              steps: [...current.steps, { text: 'New step' }],
                            }))
                          }
                        >
                          Add step
                        </button>
                      )}
                    </section>

                    <section>
                      <h4>What you&apos;re missing</h4>
                      {missing.length === 0 ? (
                        <p>Nothing essential missing from pantry.</p>
                      ) : (
                        <ul>
                          {missing.map((ingredient, index) => (
                            <li key={`${recipe.id}-missing-${index}`}>{ingredient.name}</li>
                          ))}
                        </ul>
                      )}
                    </section>

                    <section>
                      <h4>Swap suggestions</h4>
                      <ul>
                        {swaps.map((swap, index) => (
                          <li key={`${recipe.id}-swap-${index}`}>{swap}</li>
                        ))}
                      </ul>
                    </section>

                    {recipe.tips && recipe.tips.length > 0 && (
                      <section>
                        <h4>Chef tips</h4>
                        <ul>
                          {recipe.tips.map((tip, index) => (
                            <li key={`${recipe.id}-tip-${index}`}>{tip}</li>
                          ))}
                        </ul>
                      </section>
                    )}

                    <div className="action-row">
                      <button type="button" onClick={() => copyRecipe(recipe)}>
                        Copy
                      </button>
                      <button type="button" onClick={() => exportRecipe(recipe)}>
                        Export JSON
                      </button>
                      <button type="button" onClick={() => copyText(buildShareUrl(recipe), 'Share URL copied.')}
                      >
                        Share Link
                      </button>
                      <button type="button" onClick={() => duplicateIntoCookbook(recipe)}>
                        Save to Cookbook
                      </button>
                      <button type="button" onClick={() => startCookMode(recipe.id)}>
                        Start Cook Mode
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          )}

          {(compareLeft || compareRight) && (
            <section className="compare-panel">
              <h3>Recipe Comparison</h3>
              <div className="compare-grid">
                <div>
                  <h4>{compareLeft?.title ?? 'Select Compare A'}</h4>
                  {compareLeft && (
                    <ul>
                      <li>{compareLeft.cuisine}</li>
                      <li>{compareLeft.cookTimeMinutes} min</li>
                      <li>{compareLeft.difficulty}</li>
                      <li>{pantryFitPercent(compareLeft, pantryItems)}% pantry fit</li>
                    </ul>
                  )}
                </div>
                <div>
                  <h4>{compareRight?.title ?? 'Select Compare B'}</h4>
                  {compareRight && (
                    <ul>
                      <li>{compareRight.cuisine}</li>
                      <li>{compareRight.cookTimeMinutes} min</li>
                      <li>{compareRight.difficulty}</li>
                      <li>{pantryFitPercent(compareRight, pantryItems)}% pantry fit</li>
                    </ul>
                  )}
                </div>
              </div>
            </section>
          )}

          {conversation.length > 0 && (
            <section className="conversation-panel">
              <h3>Chef Assistant Trace</h3>
              <ul>
                {conversation.slice(0, 10).map((turn, index) => (
                  <li key={`${turn.createdAt}-${index}`}>
                    <strong>{turn.role === 'assistant' ? 'Assistant' : 'You'}:</strong> {turn.text}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </main>
      </section>

      {cookMode && activeCookRecipe && activeCookStep && (
        <section className="cook-mode" aria-label="Cook mode" role="dialog" aria-modal="true">
          <div className="cook-card">
            <header>
              <h2>{activeCookRecipe.title} - Cook Mode</h2>
              <button type="button" className="danger" onClick={() => setCookMode(null)}>
                Close
              </button>
            </header>

            <p>
              Step {cookMode.stepIndex + 1} / {activeCookRecipe.steps.length}
            </p>
            <p className="cook-step">{activeCookStep.text}</p>

            {activeCookStep.notes && <p className="cook-note">Note: {activeCookStep.notes}</p>}

            <div className="action-row">
              <button type="button" onClick={() => moveCookStep(-1)}>
                Previous
              </button>
              <button type="button" onClick={() => moveCookStep(1)}>
                Next
              </button>
              {activeCookStep.timerMinutes && (
                <button type="button" onClick={startStepTimer}>
                  Start {activeCookStep.timerMinutes} min Timer
                </button>
              )}
            </div>

            {cookMode.timerEndsAt && (
              <p className="timer">Timer: {Math.floor(timerSecondsRemaining / 60)}:{String(timerSecondsRemaining % 60).padStart(2, '0')}</p>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

export default App
