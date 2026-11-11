const fs = require('fs');
const pngToIco = require('png-to-ico').default;

async function buildIcon() {
    try {
        const buf = await pngToIco('C:\\Users\\lala\\.gemini\\antigravity-ide\\brain\\e2576d9b-3e89-4674-b730-f5d288d6434d\\.user_uploaded\\media_1789445109402.png');
        fs.writeFileSync('icon.ico', buf);
        console.log('Icon created successfully!');
    } catch (err) {
        console.error('Error creating icon:', err);
    }
}

buildIcon();
