// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Fajrina } from '../src/react/Fajrina'
import { validateData } from '../src/core/validate'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const validPage = {
  pageId: 'm-home',
  pageKey: 'home',
  merchantId: 'm',
  status: 'PUBLISHED',
  layout: {
    title: 'Home',
    components: [
      { id: 'h1', type: 'Heading', props: { level: 2, content: 'Halo Tes' } },
      { id: 'b1', type: 'Button', props: { label: 'Tekan' }, action: { behavior: 'toast', message: 'ok' } },
    ],
  },
}

const unknownTypePage = {
  ...validPage,
  layout: {
    title: 'Weird',
    components: [{ id: 'u1', type: 'Teleport', props: { content: 'x' } }],
  },
}

describe('Fajrina strict mode', () => {
  it('renders content when clean, even in strict mode', () => {
    render(<Fajrina data={validPage as never} mode="strict" />)
    expect(screen.getByText('Halo Tes')).toBeTruthy()
  })

  it('renders the error page instead of content when invalid', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const invalid = {
      ...validPage,
      layout: { title: 'Bad', components: [{ id: 'bad id!', type: 'Button', props: { label: 'x' } }] },
    }
    render(<Fajrina data={invalid as never} mode="strict" />)
    expect(screen.getByText(/Blocked \d+ validation issue/)).toBeTruthy()
    expect(screen.queryByText('Halo Tes')).toBeNull()
    expect(validateData(invalid).length).toBeGreaterThan(0)
    spy.mockRestore()
  })

  it('renders unknown types as nothing in strict mode too (Null-Object, not an error)', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { container } = render(<Fajrina data={unknownTypePage as never} mode="strict" />)
    expect(container.textContent).not.toContain('Blocked')
    spy.mockRestore()
  })

  it('warn mode still renders unknown types as nothing (Null-Object)', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { container } = render(<Fajrina data={unknownTypePage as never} />)
    expect(container.textContent).not.toContain('Unsupported type')
    expect(container.textContent).not.toContain('Teleport')
    spy.mockRestore()
  })
})

describe('Fajrina theme prop', () => {
  it('resolves token refs through the project theme', () => {
    const themed = {
      ...validPage,
      layout: {
        title: 'T',
        components: [{ id: 'c1', type: 'Card', style: {}, token: { backgroundColor: 'brand.primary' } }],
      },
    }
    const { container } = render(
      <Fajrina
        data={themed as never}
        theme={{ version: '1', tokens: { brand: { primary: 'rgb(1, 2, 3)' } } }}
      />
    )
    const card = container.firstChild?.firstChild as HTMLElement | null
    expect(card?.style.backgroundColor).toBe('rgb(1, 2, 3)')
  })

  it('falls back to presets for unknown tokens', () => {
    const themed = {
      ...validPage,
      layout: {
        title: 'T',
        components: [{ id: 'c1', type: 'Card', style: {}, token: { backgroundColor: 'nope.missing' } }],
      },
    }
    const { container } = render(<Fajrina data={themed as never} theme={{ tokens: {} }} />)
    const card = container.firstChild?.firstChild as HTMLElement | null
    expect(card?.style.backgroundColor).toBe('rgb(255, 255, 255)')
  })
})

describe('Fajrina form validation (no alert)', () => {
  it('emits validationError instead of alerting on missing required fields', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    const onAction = vi.fn()
    const formPage = {
      ...validPage,
      layout: {
        title: 'F',
        components: [
          {
            id: 'form1',
            type: 'Form',
            props: { submitLabel: 'Kirim' },
            children: [{ id: 'f1', type: 'Input', props: { name: 'nama', label: 'Nama', required: true } }, { id: 'sb', type: 'Button', props: { label: 'Kirim' } }],
          },
        ],
      },
    }
    const { container } = render(<Fajrina data={formPage as never} onAction={onAction} />)
    // jsdom does not implement implicit submission via button click — submit the form directly
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)
    expect(alertSpy).not.toHaveBeenCalled()
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onAction.mock.calls[0]?.[0]).toMatchObject({ behavior: 'validationError' })
    expect(container.textContent).not.toContain('No components')
    alertSpy.mockRestore()
  })
})
