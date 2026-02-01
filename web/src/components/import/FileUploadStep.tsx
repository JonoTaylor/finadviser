'use client';

import { useCallback, useState } from 'react';
import { Box, Typography, Card, CardContent } from '@mui/material';
import { alpha } from '@mui/material/styles';
import CloudUploadRoundedIcon from '@mui/icons-material/CloudUploadRounded';

export default function FileUploadStep({ onFileSelect }: { onFileSelect: (file: File) => void }) {
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.csv')) onFileSelect(file);
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
            bgcolor: dragOver ? alpha('#5EEAD4', 0.04) : 'transparent',
            '&:hover': { borderColor: 'primary.main', bgcolor: alpha('#5EEAD4', 0.04) },
          }}
          onClick={() => document.getElementById('csv-upload')?.click()}
        >
          <Box
            sx={{
              width: 64, height: 64, borderRadius: 4, mx: 'auto', mb: 2,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              bgcolor: alpha('#5EEAD4', 0.1),
            }}
          >
            <CloudUploadRoundedIcon sx={{ fontSize: 32, color: 'primary.main' }} />
          </Box>
          <Typography variant="h6">Drop CSV file here or click to upload</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Supports CSV files from your bank
          </Typography>
          <input
            id="csv-upload"
            type="file"
            accept=".csv"
            hidden
            onChange={handleChange}
          />
        </Box>
      </CardContent>
    </Card>
  );
}
