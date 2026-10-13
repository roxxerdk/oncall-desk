import "dotenv/config";

const key = process.env.ANTHROPIC_API_KEY;

if (!key) {
  console.error("Missing ANTHROPIC_API_KEY in backend/.env");
  process.exit(1);
}

try {
  const response = await fetch("https://api.anthropic.com/v1/models", {
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
  });

  if (!response.ok) {
    console.error("Model lookup failed with status:", response.status);
    const errText = await response.text();
    console.error(errText.slice(0, 400));
    process.exit(1);
  }

  const result = await response.json();
  console.log("Successfully retrieved available Anthropic models:\n");
  for (const model of result.data ?? []) {
    console.log(`- ${model.id} (${model.display_name})`);
  }
} catch (err) {
  console.error("Network or execution error:", err.message);
  process.exit(1);
}
