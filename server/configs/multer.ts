import multer from 'multer';

const storage = multer.diskStorage({});

const upload = multer({ storage });

export const modelLibraryUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    callback(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype));
  },
});

export default upload;