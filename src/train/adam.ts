/** Adam-Optimierer über einen flachen Parametervektor. */
export class Adam {
  private readonly m: Float64Array;
  private readonly v: Float64Array;
  private t = 0;

  constructor(
    size: number,
    public learningRate: number,
    private readonly beta1 = 0.9,
    private readonly beta2 = 0.999,
    private readonly eps = 1e-8,
  ) {
    this.m = new Float64Array(size);
    this.v = new Float64Array(size);
  }

  /** θ ← θ + lr · Adam(g)  (Gradientenaufstieg). */
  ascend(theta: Float64Array, grad: Float64Array): void {
    this.t++;
    const { beta1, beta2, eps, m, v } = this;
    const c1 = 1 - Math.pow(beta1, this.t);
    const c2 = 1 - Math.pow(beta2, this.t);
    for (let i = 0; i < theta.length; i++) {
      m[i] = beta1 * m[i] + (1 - beta1) * grad[i];
      v[i] = beta2 * v[i] + (1 - beta2) * grad[i] * grad[i];
      theta[i] += (this.learningRate * (m[i] / c1)) / (Math.sqrt(v[i] / c2) + eps);
    }
  }
}
