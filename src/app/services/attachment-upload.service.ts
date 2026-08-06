import { Injectable, signal, computed } from '@angular/core';
import { MessageAttachment } from '../models/message.model';
import { fileToCompressedDataUrl, formatBytes, MAX_FILE_SIZE_BYTES } from '../shared/utils/image-compressor';

export interface UploadingAttachmentItem {
  id: string;
  file: File;
  fileName: string;
  fileSize: number;
  mimeType: string;
  isImage: boolean;
  previewUrl?: string;
  progress: number;
  status: 'compressing' | 'uploading' | 'completed' | 'error';
  error?: string;
  resultAttachment?: MessageAttachment;
}

@Injectable({
  providedIn: 'root',
})
export class AttachmentUploadService {
  readonly uploadingFiles = signal<UploadingAttachmentItem[]>([]);

  readonly isUploadingAny = computed(() =>
    this.uploadingFiles().some((i) => i.status === 'compressing' || i.status === 'uploading')
  );

  readonly hasCompletedAttachments = computed(() =>
    this.uploadingFiles().some((i) => i.status === 'completed' && i.resultAttachment)
  );

  processFiles(files: File[]): string | null {
    let errorMessage: string | null = null;

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE_BYTES) {
        errorMessage = `"${file.name}" exceeds the 500 KB limit for free tier (${formatBytes(file.size)}).`;
        continue;
      }

      const isImg = file.type.startsWith('image/') && !file.type.includes('svg');
      const itemId = Math.random().toString(36).substring(2, 9);

      let previewUrl: string | undefined;
      if (isImg) {
        previewUrl = URL.createObjectURL(file);
      }

      const newItem: UploadingAttachmentItem = {
        id: itemId,
        file,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || 'application/octet-stream',
        isImage: isImg,
        previewUrl,
        progress: 0,
        status: isImg ? 'compressing' : 'uploading',
      };

      this.uploadingFiles.update((list) => [...list, newItem]);
      this.processAndUploadFile(newItem);
    }

    return errorMessage;
  }

  private async processAndUploadFile(item: UploadingAttachmentItem) {
    try {
      const { dataUrl, finalSize } = await fileToCompressedDataUrl(item.file, (percent) => {
        this.uploadingFiles.update((list) =>
          list.map((i) => (i.id === item.id ? { ...i, progress: percent } : i))
        );
      });

      const fileExt = item.fileName.includes('.') ? item.fileName.split('.').pop()?.toLowerCase() || '' : '';
      let fileType: MessageAttachment['fileType'] = 'other';
      if (item.mimeType.startsWith('image/')) fileType = 'image';
      else if (item.mimeType.startsWith('video/')) fileType = 'video';
      else if (item.mimeType.startsWith('audio/')) fileType = 'audio';
      else if (
        item.mimeType.includes('pdf') ||
        item.mimeType.includes('word') ||
        item.mimeType.includes('document') ||
        item.mimeType.includes('sheet') ||
        item.mimeType.includes('presentation') ||
        item.mimeType.includes('text') ||
        ['pdf', 'doc', 'docx', 'txt', 'zip', 'rar', 'csv', 'xlsx', 'pptx'].includes(fileExt)
      ) {
        fileType = 'document';
      }

      const attachment: MessageAttachment = {
        url: dataUrl,
        fileName: item.fileName,
        fileSize: finalSize || item.fileSize,
        fileType,
        mimeType: item.mimeType || 'application/octet-stream',
      };

      this.uploadingFiles.update((list) =>
        list.map((i) =>
          i.id === item.id
            ? { ...i, progress: 100, status: 'completed', resultAttachment: attachment, fileSize: finalSize }
            : i
        )
      );
    } catch (err: any) {
      console.error('File processing failed:', err);
      this.uploadingFiles.update((list) =>
        list.map((i) =>
          i.id === item.id ? { ...i, status: 'error', error: err.message || 'Processing failed' } : i
        )
      );
    }
  }

  removeAttachment(id: string) {
    const item = this.uploadingFiles().find((i) => i.id === id);
    if (item && item.previewUrl) {
      URL.revokeObjectURL(item.previewUrl);
    }
    this.uploadingFiles.update((list) => list.filter((i) => i.id !== id));
  }

  getCompletedAttachments(): MessageAttachment[] {
    return this.uploadingFiles()
      .filter((i) => i.status === 'completed' && i.resultAttachment)
      .map((i) => i.resultAttachment!);
  }

  clear() {
    this.uploadingFiles().forEach((item) => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
    this.uploadingFiles.set([]);
  }
}
