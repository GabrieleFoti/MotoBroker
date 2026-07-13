import sharp from 'sharp';

const [, , out, colore = '#333333'] = process.argv;
await sharp({
  create: { width: 1600, height: 1067, channels: 3, background: colore },
})
  .jpeg({ quality: 80 })
  .toFile(out);
console.log(`creato ${out}`);
