/**
 * Fajrina SDUI — Typed prop contracts per component type.
 * Mirrors what the React/Vue renderers actually read, so consumers get
 * autocomplete and typos fail at compile time instead of rendering wrong.
 * UniversalComponent.props stays Record<string, unknown> for backward
 * compatibility — use these interfaces when authoring payloads.
 */

export interface ButtonProps { label?: string; text?: string; variant?: string; type?: string; disabled?: boolean }
export interface CardProps { [key: string]: unknown }
export interface ContainerProps { gap?: string }
export interface FlexProps { direction?: 'row' | 'column'; justify?: 'start' | 'center' | 'end' | 'between'; gap?: string }
export interface GridProps { columns?: number; numColumns?: number; gap?: string }
export interface HeadingProps { level?: number; content?: string; text?: string }
export interface ImageProps { src?: string; alt?: string; loading?: string }
export interface TextProps { content?: string; text?: string; tag?: string }
export interface FormProps { submitLabel?: string; fields?: FormFieldProps[] }
export interface FormFieldProps { name: string; label?: string; type?: string; placeholder?: string; required?: boolean; options?: Array<string | { value: string; label?: string }> }
export interface InputProps { name?: string; label?: string; placeholder?: string; required?: boolean; type?: string }
export interface SelectProps { name?: string; label?: string; placeholder?: string; required?: boolean; options?: Array<string | { value: string; label?: string }> }
export interface TextareaProps { name?: string; label?: string; placeholder?: string; rows?: number; required?: boolean }
export interface LinkProps { label?: string; text?: string; href?: string; target?: string; rel?: string }
export interface DividerProps { label?: string }
export interface HeroProps { [key: string]: unknown }
export interface SpaceProps { height?: string }
export interface ToastProps { message?: string; content?: string; text?: string }
export interface ModalProps { title?: string; message?: string; content?: string }

export interface ComponentPropsMap {
  Button: ButtonProps
  Card: CardProps
  Container: ContainerProps
  Flex: FlexProps
  Grid: GridProps
  Heading: HeadingProps
  Image: ImageProps
  Text: TextProps
  Form: FormProps
  Input: InputProps
  Select: SelectProps
  Textarea: TextareaProps
  Link: LinkProps
  Divider: DividerProps
  Hero: HeroProps
  Space: SpaceProps
  Toast: ToastProps
  Modal: ModalProps
}

export type UniversalComponentTypeName = keyof ComponentPropsMap

/** Typed props for a known component type; Record fallback for forward-compat. */
export type PropsFor<T extends UniversalComponentTypeName> = ComponentPropsMap[T]
