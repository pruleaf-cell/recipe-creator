import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('navigator', {
      ...window.navigator,
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
  })

  it('renders and generates recipe options', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.type(screen.getByLabelText(/Add ingredient/i), 'onion')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.click(screen.getByRole('button', { name: /Generate 3-6 recipes/i }))

    expect(await screen.findByText(/Generated \d recipe options/i)).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 3 }).length).toBeGreaterThan(0)
  })

  it('creates and saves a custom recipe in the builder', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /Recipe Builder/i }))
    await user.type(screen.getByLabelText('Title'), 'My Test Soup')
    await user.type(screen.getByLabelText('Ingredient name 1'), 'carrot')
    await user.clear(screen.getByLabelText('Step text 1'))
    await user.type(screen.getByLabelText('Step text 1'), 'Chop and simmer for 20 minutes.')

    await user.click(screen.getByRole('button', { name: /Save recipe/i }))

    expect(await screen.findByText(/Recipe saved to local storage/i)).toBeInTheDocument()
    expect(screen.getByText('My Test Soup')).toBeInTheDocument()
  })
})
