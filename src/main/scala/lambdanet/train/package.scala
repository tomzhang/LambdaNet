package lambdanet

import botkop.numsca.Tensor
import cats.Monoid
import funcdiff.CompNode

package object train {
  type Logits = CompNode
  type Loss = CompNode
  type Correct = Int
  type LibCorrect = Correct
  type ProjCorrect = Correct

  def nonZero(n: Int): Double = if (n == 0) 1.0 else n.toDouble

  def toAccuracy(counts: Counted[Int]): Double = {
    counts.value.toDouble / nonZero(counts.count)
  }

  def toAccuracyD(counts: Counted[Double]): Double = {
    def nonZero(n: Double): Double = if (n == 0) 1.0 else n.toDouble
    counts.value / nonZero(counts.count)
  }

  case class Counted[V](count: Int, value: V)

  object Counted {
    def zero[V](v: V) = Counted(0, v)
  }

  implicit def countedMonoid[V](
      implicit m: Monoid[V],
  ): Monoid[Counted[V]] = new Monoid[Counted[V]] {
    def empty: Counted[V] = Counted(0, m.empty)

    def combine(x: Counted[V], y: Counted[V]): Counted[V] = {
      Counted(x.count + y.count, m.combine(x.value, y.value))
    }
  }

//  implicit object LossMonoid extends Monoid[Loss] {
//    def empty: Loss = 0.0
//
//    def combine(x: Loss, y: Loss): Loss = x + y
//  }

  implicit object TensorMonoid extends Monoid[Tensor] {
    def empty: Tensor = Tensor(0.0)

    def combine(x: Tensor, y: Tensor): Tensor = x + y
  }
}
