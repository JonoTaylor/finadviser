'use client';

import { useCallback, useState } from 'react';
import { Box, Typography, Card, CardContent } from '@mui/material';
import { softTokens } from '@/theme/theme';
import CloudUploadRoundedIcon from '@mui/icons-material/CloudUploadRounded';

const ACCEPTED_EXTENSIONS = ['.csv', '.pdf'];

function isAcceptedFile(file: File): boolean {
  return ACCEPTED_EXTENSIONS.some(ext => file.name.toLowerCase().endsWith(ext));
}

export default function FileUploadStep({ onFileSelect }: { onFileSelect: (file: File) => void }) {
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && isAcceptedFile(file)) onFileSelect(file);
  }, [onFileSelect]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFileSelect(file);
  }, [onFileSelect]);

  return (
    <Card>
      <CardContent>
        <Box
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          sx={{
            border: '2px dashed',
            borderColor: dragOver ? 'primary.main' : 'divider',
            borderRadius: 4,
            p: 8,
            textAlign: 'center',
            cursor: 'pointer',
            transition: 'all 0.2s',
            bgcolor: dragOver ? softTokens.fog : 'transparent',
            '&:hover': { borderColor: 'primary.main', bgcolor: softTokens.fog },
          }}
          onClick={() => document.getElementById('file-upload')?.click()}
        >
          <Box
            sx={{
              width: 64, height: 64, borderRadius: 4, mx: 'auto', mb: 2,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              bgcolor: softTokens.lavender.main,
              color: softTokens.lavender.ink,
            }}
          >
            <CloudUploadRoundedIcon sx={{ fontSize: 32 }} />
          </Box>
          <Typography variant="h6">Drop CSV or PDF file here or click to upload</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Supports CSV files and PDF bank statements
          </Typography>
          <input
            id="file-upload"
            type="file"
            accept=".csv,.pdf"
            hidden
            onChange={handleChange}
          />
        </Box>
      </CardContent>
    </Card>
  );
}
