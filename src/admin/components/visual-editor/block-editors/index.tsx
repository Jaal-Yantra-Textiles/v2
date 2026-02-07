import { ComponentType } from "react"
import { AdminBlock } from "../../../hooks/api/blocks"
import { HeroBlockEditor } from "./hero-block-editor"
import { HeaderBlockEditor } from "./header-block-editor"
import { FeatureBlockEditor } from "./feature-block-editor"
import { BentoBlockEditor } from "./bento-block-editor"
import { TestimonialsBlockEditor } from "./testimonials-block-editor"
import { FooterBlockEditor } from "./footer-block-editor"
import { MainContentBlockEditor } from "./main-content-block-editor"
import { GalleryBlockEditor } from "./gallery-block-editor"
import { GenericBlockEditor } from "./generic-block-editor"

export interface BlockEditorProps {
  block: AdminBlock
  content: Record<string, unknown>
  settings: Record<string, unknown>
  onContentChange: (content: Record<string, unknown>) => void
  onSettingsChange: (settings: Record<string, unknown>) => void
}

const blockEditors: Record<string, ComponentType<BlockEditorProps>> = {
  Hero: HeroBlockEditor,
  Header: HeaderBlockEditor,
  Feature: FeatureBlockEditor,
  Bento: BentoBlockEditor,
  Section: BentoBlockEditor, // Reuse Bento editor for Section blocks
  Testimonial: TestimonialsBlockEditor,
  Footer: FooterBlockEditor,
  MainContent: MainContentBlockEditor,
  Gallery: GalleryBlockEditor,
  ContactForm: GenericBlockEditor,
  Product: GenericBlockEditor,
  Custom: GenericBlockEditor,
}

export function getBlockEditor(type: string): ComponentType<BlockEditorProps> {
  return blockEditors[type] || GenericBlockEditor
}

export {
  HeroBlockEditor,
  HeaderBlockEditor,
  FeatureBlockEditor,
  BentoBlockEditor,
  TestimonialsBlockEditor,
  FooterBlockEditor,
  MainContentBlockEditor,
  GalleryBlockEditor,
  GenericBlockEditor,
}
