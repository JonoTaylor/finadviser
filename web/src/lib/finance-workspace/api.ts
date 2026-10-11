import { NextResponse } from 'next/server';
import { z } from 'zod';
import { WorkspaceConflictError, WorkspaceStoredDataError } from './store';

export function workspaceErrorResponse(error: unknown): NextResponse {
  if (error instanceof WorkspaceConflictError) {
    return NextResponse.json({ code: 'WORKSPACE_CONFLICT', error: error.message }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
  }
  if (error instanceof WorkspaceStoredDataError) {
    return NextResponse.json({ code: 'WORKSPACE_INVALID', error: error.message }, { status: 422, headers: { 'Cache-Control': 'no-store' } });
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json({ code: 'VALIDATION_FAILED', error: error.issues.map(issue => `${issue.path.join('.') || 'workspace'}: ${issue.message}`).join('; ') }, { status: 400 });
  }
  return NextResponse.json({ code: 'WORKSPACE_UNAVAILABLE', error: 'Your saved financial workspace is unavailable. Check the connection and retry. Your entries have not been replaced.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
}
