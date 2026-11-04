import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DemoService } from '../demo/demo.service';

/** Builds the demo company once (the /resetdemo page rebuilds it any time). `--reset` wipes and rebuilds it. */
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'log'] });
  const demo = app.get(DemoService);
  if ((await demo.exists()) && !process.argv.includes('--reset')) {
    console.log('Đã có công ty demo, không tạo lại (thêm --reset để xoá và dựng lại).');
    await app.close();
    return;
  }
  const r = await demo.reset();
  console.log(`Đã dựng ${r.company}: ${r.figures.shifts} ca, ${r.figures.attendances} lần chấm công, ${r.figures.violations} vi phạm.`);
  console.log(`Mật khẩu chung: ${r.password}`);
  for (const a of r.accounts) console.log(`  ${a.role.padEnd(22)} ${a.phone}  ${a.name}`);
  await app.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
