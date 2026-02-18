import { html, type TemplateResult } from "lit";

export type StatusTone = "neutral" | "success" | "warn" | "danger";

export type StatusCardProps = {
  title: string;
  subtitle?: string;
  tone?: StatusTone;
  body: TemplateResult;
};

export function renderStatusCard(props: StatusCardProps): TemplateResult {
  const tone = props.tone ?? "neutral";
  const toneClass =
    tone === "success" ? "success" : tone === "warn" ? "warn" : tone === "danger" ? "danger" : "";
  return html`
    <div class="card">
      <div class="card-title">${props.title}</div>
      ${props.subtitle ? html`<div class="card-sub">${props.subtitle}</div>` : html``}
      <div class="${toneClass ? `callout ${toneClass}` : ""}" style="margin-top: 12px;">
        ${props.body}
      </div>
    </div>
  `;
}

