/**
 * The protocols section was absorbed from the standalone wcems-protocols
 * app, which is plain-JS Vue — its SFCs carry no script types, so the
 * TS router can't infer them. Typed as generic components until the
 * section is (ever) migrated to TS.
 */
declare module '@/views/protocols/*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}
