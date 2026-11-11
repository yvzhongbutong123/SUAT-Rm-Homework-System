'use strict';

/**
 * 演示数据与仓库模板。
 * - buildTemplateFiles(): 真实仓库初始化时写入的空模板（不含虚构提交）
 * - buildDemoFiles():     演示模式使用的完整示例仓库
 */

const GROUPS = [
  { id: 'algo', name: '算法组', folder: '算法组', color: '#4f8cff', short: 'ALGO' },
  { id: 'mech', name: '机械组', folder: '机械组', color: '#f6a723', short: 'MECH' },
  { id: 'embedded', name: '嵌入式组', folder: '嵌入式组', color: '#2fd48f', short: 'EMB' },
];

const TEAMS_JSON = {
  version: 1,
  teamName: 'RoboMaster 战队',
  season: '2026',
  groups: GROUPS,
  leaderRedeemCodes: ['pxr20080819Q'],
  storage: {
    provider: 'github',
    largeFile: {
      enabled: false,
      provider: 'oss',
      thresholdMB: 20,
      note: '预留接口：超过阈值的文件可由 OSS / 网盘承接，当前版本优先使用 GitHub。',
    },
  },
};

const WEEK1_README = `# Week 01 · 环境搭建与基本功

> 本周为赛季启动周，目标是让每个人把开发环境跑通，并完成第一个可演示的小作品。

## 本周任务

1. **环境自检**：按各组说明完成开发环境安装，提交一份 \`env-report.md\`（截图 + 版本号）。
2. **基础练习**：完成本组指定的基础练习，代码放在提交目录中。
3. **组内互评**：浏览另外两位同学的提交，在 \`review.md\` 里写两条改进建议。

## 提交要求

- 提交整个文件夹，系统会自动以你的 GitHub 账号命名。
- 代码需要有 README 说明如何运行。
- 截止时间：**本周日 23:59**。

## 评分标准

| 维度 | 分值 | 说明 |
| --- | --- | --- |
| 完成度 | 40 | 任务是否全部完成 |
| 代码质量 | 30 | 结构、命名、注释 |
| 文档 | 20 | README 与报告清晰度 |
| 规范 | 10 | 提交结构与命名 |
`;

const GROUP_README = {
  algo: `## 算法组本周重点

- 安装 OpenCV 4.10 + Python 3.11，跑通官方相机标定示例。
- 用 \`cv2.solvePnP\` 完成一次位姿解算，输出重投影误差。
- 提交内容：\`env-report.md\`、\`calibration/\`（标定参数）、\`solvepnp.py\`。

**加分项**：用 Ros2 话题接收图像并实时解算，附一段录屏。`,
  mech: `## 机械组本周重点

- 安装 SolidWorks 2024（或 Fusion 360），完成云台底座的参数化建模。
- 学会导出 STEP 与工程图，图纸需标注关键配合尺寸。
- 提交内容：\`env-report.md\`、\`gimbal-base.STEP\`、\`drawing.pdf\`、\`bom.xlsx\`。

**加分项**：给出两种减重方案的对比（拓扑优化前后质量）。`,
  embedded: `## 嵌入式组本周重点

- 搭建 STM32CubeIDE 开发环境，完成 LED 闪烁与串口打印。
- 配置 CAN 外设，实现两帧周期报文的发送（回环模式即可）。
- 提交内容：\`env-report.md\`、\`firmware/\`（完整工程）、\`can-test.md\`。

**加分项**：用示波器抓取 PWM 波形并附截图。`,
};

const WEEK1_META = {
  title: '环境搭建与基本功',
  deadline: '2026-11-15T23:59:00+08:00',
  publishedAt: '2026-11-09T00:00:00+08:00',
  tags: ['环境', '基本功'],
};

const WEEK2_README = `# Week 02 · 目标识别与机构设计

## 本周任务

1. 算法组：基于颜色阈值 + 轮廓筛选实现装甲板灯条检测，输出装甲板中心坐标。
2. 机械组：完成云台俯仰轴的连杆布置，输出运动简图与干涉检查报告。
3. 嵌入式组：使用 PID 闭环控制直流电机转速，采样数据并绘制阶跃响应曲线。

## 提交要求

- 继续提交整个文件夹；上一周的代码保留在你的目录中即可。
- 需要附一份 \`report.md\`，说明思路、遇到的问题与解决方案。
- 截止时间：**下周一 23:59**（因周末有比赛调车，顺延一天）。
`;

const WEEK2_META = {
  title: '目标识别与机构设计',
  deadline: '2026-11-17T23:59:00+08:00',
  publishedAt: '2026-11-13T09:00:00+08:00',
  tags: ['视觉', '结构', '控制'],
};

const WEEK3_README = `# Week 03 · 联调与性能优化

> 本周进入整车联调阶段，请各组按接口文档对齐。

## 任务

- 算法组：将装甲板识别接入 \`/detector/detections\` 话题，帧率 ≥ 60 FPS。
- 机械组：完成整车装配的干涉检查，输出最新 BOM。
- 嵌入式组：实现底盘功率限制，超功率时自动降速并上报状态码。

## 提交

- 需要提交联调视频链接（写在 \`report.md\` 中）。
- 截止时间：**本周日 22:00**。
`;

const WEEK3_META = {
  title: '联调与性能优化',
  deadline: '2026-11-22T22:00:00+08:00',
  publishedAt: '2026-11-18T09:00:00+08:00',
  tags: ['联调', '性能'],
};

function file(rel, content) {
  return { rel, content };
}

function buildTemplateFiles(leaderLogin) {
  return [
    file('README.md', `# Rm-Homework\n\nRoboMaster 战队作业仓库，由「RoboMaster 战队作业管理」客户端自动维护。\n\n## 目录结构\n\n\`\`\`\nweekNN/\n├─ README.md            本周作业要求\n├─ meta.json            截止时间等元数据\n├─ 算法组/\n│  ├─ README.md         算法组作业（机械组、嵌入式组同理）\n│  └─ submissions/\n│     └─ <github-login>/ 组员提交（自动以其账号命名）\n│        └─ evaluation.json 组长批改结果\n\`\`\`\n\n## 角色\n\n- 组长：由兑换码或已有组长分配\n- 组员：按 \`members.json\` 中的 group 归属算法 / 机械 / 嵌入式组\n`),
    file('teams.json', JSON.stringify(TEAMS_JSON, null, 2) + '\n'),
    file(
      'members.json',
      JSON.stringify(
        {
          version: 1,
          updatedAt: new Date().toISOString(),
          members: leaderLogin
            ? {
                [leaderLogin]: {
                  role: 'leader',
                  group: null,
                  name: leaderLogin,
                  createdAt: new Date().toISOString(),
                },
              }
            : {},
        },
        null,
        2,
      ) + '\n',
    ),
    file('week01/README.md', WEEK1_README),
    file('week01/meta.json', JSON.stringify(WEEK1_META, null, 2) + '\n'),
    file('week01/算法组/README.md', GROUP_README.algo + '\n'),
    file('week01/机械组/README.md', GROUP_README.mech + '\n'),
    file('week01/嵌入式组/README.md', GROUP_README.embedded + '\n'),
    file('week01/算法组/submissions/.gitkeep', ''),
    file('week01/机械组/submissions/.gitkeep', ''),
    file('week01/嵌入式组/submissions/.gitkeep', ''),
    file('week02/README.md', WEEK2_README),
    file('week02/meta.json', JSON.stringify(WEEK2_META, null, 2) + '\n'),
    file('week02/算法组/README.md', '## 算法组补充\n\n- 灯条筛选建议使用 HSV 空间，注意场地灯光干扰。\n'),
    file('week02/机械组/README.md', '## 机械组补充\n\n- 连杆布置需给出极限位置校核，避免与弹仓干涉。\n'),
    file('week02/嵌入式组/README.md', '## 嵌入式组补充\n\n- PID 参数整定记录请附上波形截图。\n'),
    file('week02/算法组/submissions/.gitkeep', ''),
    file('week02/机械组/submissions/.gitkeep', ''),
    file('week02/嵌入式组/submissions/.gitkeep', ''),
    file('week03/README.md', WEEK3_README),
    file('week03/meta.json', JSON.stringify(WEEK3_META, null, 2) + '\n'),
    file('week03/算法组/README.md', '## 算法组补充\n\n- 检测接口字段见 `docs/detector-api.md`，请严格对齐。\n'),
    file('week03/机械组/README.md', '## 机械组补充\n\n- BOM 请使用统一模板，标注采购周期。\n'),
    file('week03/嵌入式组/README.md', '## 嵌入式组补充\n\n- 功率限制需要包含裁判系统数据校验。\n'),
    file('week03/算法组/submissions/.gitkeep', ''),
    file('week03/机械组/submissions/.gitkeep', ''),
    file('week03/嵌入式组/submissions/.gitkeep', ''),
    file('.gitignore', '*.tmp\n.DS_Store\nThumbs.db\nnode_modules/\n'),
  ];
}

/* ------------------------------------------------------------------ */
/* 演示数据                                                            */
/* ------------------------------------------------------------------ */

const DEMO_MEMBERS = {
  'rm-leader': { role: 'leader', group: null, name: '王磊（队长）', createdAt: '2026-09-01T10:00:00+08:00' },
  alice: { role: 'member', group: 'algo', name: '陈思远', createdAt: '2026-09-02T10:00:00+08:00' },
  bob: { role: 'member', group: 'algo', name: '李昊然', createdAt: '2026-09-02T10:05:00+08:00' },
  diana: { role: 'member', group: 'algo', name: '周雨桐', createdAt: '2026-09-05T14:20:00+08:00' },
  carol: { role: 'member', group: 'mech', name: '赵子轩', createdAt: '2026-09-02T11:00:00+08:00' },
  eric: { role: 'member', group: 'mech', name: '孙铭', createdAt: '2026-09-08T09:30:00+08:00' },
  frank: { role: 'member', group: 'embedded', name: '吴嘉树', createdAt: '2026-09-02T12:00:00+08:00' },
  grace: { role: 'member', group: 'embedded', name: '林晓', createdAt: '2026-09-10T16:00:00+08:00' },
};

function submissionMeta(login, group, week, files, bytes, at) {
  return JSON.stringify(
    {
      version: 1,
      week,
      login,
      group,
      uploadedAt: at,
      fileCount: files,
      totalBytes: bytes,
      client: 'RM-Homework/1.0.0',
    },
    null,
    2,
  );
}

function evaluation(week, login, group, score, comment, gradedAt, gradedBy = 'rm-leader') {
  return JSON.stringify(
    {
      version: 1,
      week,
      member: login,
      group,
      score,
      comment,
      gradedBy,
      gradedAt,
      rubric: null,
    },
    null,
    2,
  );
}

function buildDemoFiles() {
  const files = [
    ...buildTemplateFiles('rm-leader'),
    file(
      'members.json',
      JSON.stringify({ version: 1, updatedAt: '2026-11-08T20:00:00+08:00', members: DEMO_MEMBERS }, null, 2) + '\n',
    ),
  ];

  // ---------- week01 提交 ----------
  files.push(
    file(
      'week01/算法组/submissions/alice/submission.json',
      submissionMeta('alice', 'algo', 'week01', 4, 18234, '2026-11-12T21:04:00+08:00'),
    ),
    file(
      'week01/算法组/submissions/alice/env-report.md',
      '# 环境自检报告\n\n- 系统：Windows 11 23H2\n- Python：3.11.7\n- OpenCV：4.10.0\n- CUDA：12.1\n\n相机标定已跑通，重投影误差 **0.31 px**。\n',
    ),
    file(
      'week01/算法组/submissions/alice/solvepnp.py',
      `import cv2\nimport numpy as np\n\ndef solve_pose(image_points, camera_matrix, dist_coeffs):\n    """用 solvePnP 解算装甲板位姿。"""\n    object_points = np.array([\n        [-0.1, 0.1, 0], [0.1, 0.1, 0], [0.1, -0.1, 0], [-0.1, -0.1, 0]\n    ], dtype=np.float32)\n    ok, rvec, tvec = cv2.solvePnP(\n        object_points, image_points, camera_matrix, dist_coeffs,\n        flags=cv2.SOLVEPNP_IPPE\n    )\n    if not ok:\n        raise RuntimeError("solvePnP failed")\n    return rvec, tvec\n\nif __name__ == "__main__":\n    print(cv2.__version__)\n`,
    ),
    file(
      'week01/算法组/submissions/alice/calibration/camera.yml',
      'image_width: 1280\nimage_height: 1024\nfx: 1290.4\nfy: 1289.8\ncx: 642.1\ncy: 511.7\nk1: -0.081\nk2: 0.022\n',
    ),
    file(
      'week01/算法组/submissions/alice/review.md',
      '- bob 的代码结构清晰，建议把标定参数抽到配置文件里。\n- diana 的报告缺少误差分析，可以补一张重投影散点图。\n',
    ),
    file(
      'week01/算法组/submissions/alice/evaluation.json',
      evaluation(
        'week01',
        'alice',
        'algo',
        92,
        '标定流程完整，重投影误差控制得很好；solvePnP 用了 IPPE 方案，说明查过文档。建议把相机参数外置并补一组实车验证数据。',
        '2026-11-13T10:12:00+08:00',
      ),
    ),

    file(
      'week01/算法组/submissions/bob/submission.json',
      submissionMeta('bob', 'algo', 'week01', 3, 9310, '2026-11-12T22:40:00+08:00'),
    ),
    file(
      'week01/算法组/submissions/bob/env-report.md',
      '# 环境自检报告\n\n- Ubuntu 22.04（WSL2）\n- Python 3.11.9\n- OpenCV 4.9.0\n\n相机标定完成，误差 0.45 px。\n',
    ),
    file(
      'week01/算法组/submissions/bob/calibrate.py',
      `import cv2\n\nCHECKERBOARD = (9, 6)\ncriteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.001)\n\ndef calibrate(images):\n    objp = np.zeros((CHECKERBOARD[0] * CHECKERBOARD[1], 3), np.float32)\n    objp[:, :2] = np.mgrid[0:9, 0:6].T.reshape(-1, 2)\n    # ... 省略标定细节\n    return chessboard_flags\n`,
    ),
    file(
      'week01/算法组/submissions/bob/evaluation.json',
      evaluation(
        'week01',
        'bob',
        'algo',
        85,
        '环境跑通了，标定脚本可用。代码里直接用了 np 却没有 import numpy，交之前请自测一遍。',
        '2026-11-13T10:20:00+08:00',
      ),
    ),

    file(
      'week01/算法组/submissions/diana/submission.json',
      submissionMeta('diana', 'algo', 'week01', 2, 5120, '2026-11-13T09:15:00+08:00'),
    ),
    file(
      'week01/算法组/submissions/diana/env-report.md',
      '# 环境自检\n\n- Windows 11\n- Python 3.10\n- OpenCV 4.8\n\n标定已做，误差 0.62 px，还在调。\n',
    ),
    file(
      'week01/算法组/submissions/diana/calibration_params.json',
      '{\n  "fx": 1277.2,\n  "fy": 1276.9,\n  "cx": 638.0,\n  "cy": 509.2,\n  "reprojection_error": 0.62\n}\n',
    ),

    file(
      'week01/机械组/submissions/carol/submission.json',
      submissionMeta('carol', 'mech', 'week01', 4, 2450000, '2026-11-12T20:22:00+08:00'),
    ),
    file(
      'week01/机械组/submissions/carol/env-report.md',
      '# 机械组环境自检\n\n- SolidWorks 2024 SP2\n- 显卡：RTX 3060\n\n云台底座参数化建模完成，关键配合尺寸 Ø34 H7/g6。\n',
    ),
    file(
      'week01/机械组/submissions/carol/bom.xlsx',
      'placeholder-bom\n',
    ),
    file(
      'week01/机械组/submissions/carol/gimbal-base.STEP',
      "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('Gimbal base'),'2;1');\nENDSEC;\nDATA;\n/* 演示占位：真实项目请提交完整 STEP */\nENDSEC;\nEND-ISO-10303-21;\n",
    ),
    file(
      'week01/机械组/submissions/carol/drawing.pdf',
      '%PDF-1.4\n% 演示占位文件\n',
    ),

    file(
      'week01/嵌入式组/submissions/frank/submission.json',
      submissionMeta('frank', 'embedded', 'week01', 5, 46200, '2026-11-12T19:50:00+08:00'),
    ),
    file(
      'week01/嵌入式组/submissions/frank/env-report.md',
      '# 嵌入式环境自检\n\n- STM32CubeIDE 1.16.0\n- STM32F407VET6\n- 串口 115200 打印正常\n- CAN 回环发送成功（500 kbps）\n',
    ),
    file(
      'week01/嵌入式组/submissions/frank/firmware/main.c',
      `#include "main.h"\n#include "can.h"\n#include "usart.h"\n\nCAN_TxHeaderTypeDef tx;\nuint8_t data[8] = {0x01, 0x02};\nuint32_t mailbox;\n\nint main(void) {\n  HAL_Init();\n  SystemClock_Config();\n  MX_GPIO_Init();\n  MX_CAN1_Init();\n  MX_USART1_UART_Init();\n\n  tx.StdId = 0x201;\n  tx.IDE = CAN_ID_STD;\n  tx.RTR = CAN_RTR_DATA;\n  tx.DLC = 8;\n\n  while (1) {\n    HAL_CAN_AddTxMessage(&hcan1, &tx, data, &mailbox);\n    HAL_Delay(10);\n  }\n}\n`,
    ),
    file(
      'week01/嵌入式组/submissions/frank/can-test.md',
      'CAN 回环测试记录：\n\n- 波特率 500 kbps\n- 周期 10 ms\n- 用 PCAN 抓包确认 ID 0x201 / 0x202 正常\n',
    ),
    file(
      'week01/嵌入式组/submissions/frank/evaluation.json',
      evaluation(
        'week01',
        'frank',
        'embedded',
        88,
        'CAN 回环与串口都通了，工程结构规范。下一次把发送周期改成定时器中断触发，别用 HAL_Delay 阻塞主循环。',
        '2026-11-13T10:40:00+08:00',
      ),
    ),
  );

  // ---------- week02 ----------
  files.push(
    file(
      'week02/算法组/submissions/alice/submission.json',
      submissionMeta('alice', 'algo', 'week02', 3, 22400, '2026-11-16T23:12:00+08:00'),
    ),
    file(
      'week02/算法组/submissions/alice/lights.py',
      `import cv2\nimport numpy as np\n\nLIGHT_LOW = np.array([0, 120, 120])\nLIGHT_HIGH = np.array([12, 255, 255])\n\ndef find_lights(frame):\n    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)\n    mask = cv2.inRange(hsv, LIGHT_LOW, LIGHT_HIGH)\n    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))\n    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)\n    return [c for c in contours if cv2.contourArea(c) > 30]\n`,
    ),
    file(
      'week02/算法组/submissions/alice/report.md',
      '# 灯条检测实验\n\n- 阈值范围：H 0-12 / S 120-255 / V 120-255\n- 在 1280×1024 上单帧耗时 **2.1 ms**\n- 问题：场地蓝光会造成误检，下一步加入长宽比过滤。\n',
    ),

    file(
      'week02/机械组/submissions/carol/submission.json',
      submissionMeta('carol', 'mech', 'week02', 2, 820000, '2026-11-17T18:40:00+08:00'),
    ),
    file(
      'week02/机械组/submissions/carol/report.md',
      '# 俯仰轴连杆布置\n\n- 采用四连杆机构，电机后置，降低云台重心\n- 极限位置与弹仓最小间隙 6.5 mm\n- 干涉检查通过（SolidWorks Motion）\n',
    ),
    file(
      'week02/机械组/submissions/carol/linkage-diagram.svg',
      '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#111"/><circle cx="80" cy="120" r="14" fill="#f6a723"/><circle cx="240" cy="60" r="14" fill="#4f8cff"/><line x1="80" y1="120" x2="240" y2="60" stroke="#fff" stroke-width="4"/><text x="20" y="24" fill="#fff" font-size="14">Pitch Linkage</text></svg>\n',
    ),

    file(
      'week02/嵌入式组/submissions/frank/submission.json',
      submissionMeta('frank', 'embedded', 'week02', 4, 38100, '2026-11-17T17:05:00+08:00'),
    ),
    file(
      'week02/嵌入式组/submissions/frank/pid.c',
      `#include "pid.h"\n\nfloat pid_step(PID *p, float target, float actual, float dt) {\n  float err = target - actual;\n  p->integral += err * dt;\n  if (p->integral > p->limit) p->integral = p->limit;\n  if (p->integral < -p->limit) p->integral = -p->limit;\n  float deriv = (err - p->last) / dt;\n  p->last = err;\n  return p->kp * err + p->ki * p->integral + p->kd * deriv;\n}\n`,
    ),
    file(
      'week02/嵌入式组/submissions/frank/report.md',
      '# 电机转速闭环\n\n- 控制周期 1 ms\n- 阶跃响应上升时间 38 ms，超调 4.2%\n- 波形见 `step-response.png`\n',
    ),
  );

  // ---------- 未提交/待批改状态补充 ----------
  files.push(
    file('week03/算法组/submissions/alice/submission.json', submissionMeta('alice', 'algo', 'week03', 1, 2100, '2026-11-21T20:00:00+08:00')),
    file(
      'week03/算法组/submissions/alice/report.md',
      '# 联调记录\n\n检测接口已接通，目前 72 FPS（1080p）。\n',
    ),
  );

  return files;
}

module.exports = {
  GROUPS,
  TEAMS_JSON,
  DEMO_MEMBERS,
  buildTemplateFiles,
  buildDemoFiles,
  WEEK_META: { week01: WEEK1_META, week02: WEEK2_META, week03: WEEK3_META },
};
