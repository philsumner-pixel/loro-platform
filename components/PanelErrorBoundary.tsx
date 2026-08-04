'use client'

import React from 'react'

// Wraps the draft editor so a render error shows what went wrong instead of
// silently blanking the panel — which is how the TipTap SSR crash and the
// lead-image regression both presented ("the button does nothing").

interface State { error: Error | null }

export default class PanelErrorBoundary extends React.Component<
  { children: React.ReactNode; label?: string },
  State
> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[Loro panel error]', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          border: '1px solid #F5C6C6', background: '#FDF2F2',
          padding: '16px 18px', margin: '12px 0',
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#A33A3A', marginBottom: 6 }}>
            {this.props.label ?? 'This panel'} failed to render
          </div>
          <div style={{ fontSize: 12.5, color: '#A33A3A', fontFamily: 'monospace', lineHeight: 1.6 }}>
            {this.state.error.message}
          </div>
          <button
            onClick={() => this.setState({ error: null })}
            style={{
              marginTop: 10, fontSize: 12, background: 'none',
              border: '1px solid #D9A0A0', padding: '5px 10px',
              color: '#A33A3A', cursor: 'pointer',
            }}
          >Try again</button>
        </div>
      )
    }
    return this.props.children
  }
}
