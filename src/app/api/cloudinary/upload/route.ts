import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET;

  if (!cloudName || !uploadPreset) {
    return NextResponse.json(
      {
        error:
          "Missing Cloudinary configuration. Set NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME and CLOUDINARY_UPLOAD_PRESET.",
      },
      { status: 500 },
    );
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  const uploadBody = new FormData();
  uploadBody.append("file", file);
  uploadBody.append("upload_preset", uploadPreset);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    {
      method: "POST",
      body: uploadBody,
    },
  );

  const payload = await response.json();

  if (!response.ok) {
    return NextResponse.json(
      { error: payload?.error?.message ?? "Cloudinary upload failed" },
      { status: response.status },
    );
  }

  return NextResponse.json({ url: payload.secure_url }, { status: 200 });
}
