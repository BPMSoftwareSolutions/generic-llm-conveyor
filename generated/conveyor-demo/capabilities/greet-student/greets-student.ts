// @generated
// projector-id: declarative-typescript-body-projector
// projector-key-id: sha256:8f219860f51d00d4e1c9bf679a6a5614a7f85ab2a60a85da4fbe91ed234bec38
// projection-id: project-greets-student-body-from-916b23577d99cdb00dca915f994898f535df11ba50514eb3c083098625447468
// authority-sha256: sha256:4eabb27ee790d44ae3a45c361817730bc4648d7d4f395c4dde7817e9a47aa7f4
// body-sha256: sha256:e184670a74ec45efe56af17cf3a80f1db599d8ae9ab150005eee1583292553cd
// projection-signature: ed25519:td5PdSCBJXjQafOAkhWR/opekNdk4kdvdP4VTn2b+YxNSDCDc/Q8DPRpcjlXy1F1uFFsOD9vM02X7geQmQIkAQ==
// DO NOT EDIT.
export async function greetsStudent(
  context: GreetsStudentContext
): Promise<StudentGreetingSignal> {
  return await context.edges.invokes(
    "resolve-student-greeting",
    context
  );
}
