// Função para carregar .env manualmente
async function loadEnv() {
  try {
    const content = await Deno.readTextFile(".env");
    const lines = content.split("\n");
    
    for (const line of lines) {
      // Pular comentários e linhas vazias
      if (line.trim() && !line.trim().startsWith("#")) {
        const [key, ...valueParts] = line.split("=");
        if (key && valueParts.length) {
          let value = valueParts.join("=").trim();
          // Remover aspas
          value = value.replace(/^["']|["']$/g, '');
          Deno.env.set(key.trim(), value);
          console.log(`✅ Carregado: ${key.trim()}`);
        }
      }
    }
    return true;
  } catch (error) {
    console.error("❌ Erro ao carregar .env");
    return false;
  }
}

// Carregar o .env primeiro
console.log("📂 Carregando arquivo .env...");
await loadEnv();

// Agora verificar as variáveis
console.log("\n📋 Variáveis carregadas:");
console.log("SUPABASE_URL:", Deno.env.get("SUPABASE_URL"));
console.log("SUPABASE_SERVICE_ROLE_KEY:", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ? "✅ Existe" : "❌ Não existe");
console.log("SUPABASE_ANON_KEY:", Deno.env.get("SUPABASE_ANON_KEY") ? "✅ Existe" : "❌ Não existe");
console.log("STRIPE_SECRET_KEY:", Deno.env.get("STRIPE_SECRET_KEY") ? "✅ Existe" : "❌ Não existe");
