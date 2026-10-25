'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Alert, Button } from '@mui/material';

interface SectionBoundaryProps {
  /** Names the section in the fallback, e.g. "Tenancies". */
  title: string;
  /** Matches the bottom margin of stacked cards so the layout does not jump. */
  gutterBottom?: boolean;
  children: ReactNode;
}

interface SectionBoundaryState { failed: boolean }

/**
 * Contains a rendering failure to one card so the rest of the page stays
 * usable. Data loading failures are still each card's own responsibility.
 */
export default class SectionBoundary extends Component<SectionBoundaryProps, SectionBoundaryState> {
  state: SectionBoundaryState = { failed: false };

  static getDerivedStateFromError(): SectionBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(`${this.props.title} failed to render`, error, info.componentStack);
  }

  private retry = () => this.setState({ failed: false });

  render() {
    if (!this.state.failed) return this.props.children;
    return <Alert
      severity="warning"
      action={<Button color="inherit" size="small" onClick={this.retry}>Retry</Button>}
      sx={{ height: '100%', mb: this.props.gutterBottom ? 3 : 0 }}
    >
      {this.props.title} could not be displayed. The rest of this page is unaffected and your saved data has not changed.
    </Alert>;
  }
}
